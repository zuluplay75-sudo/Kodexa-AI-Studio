import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextPlanningStages, STAGES, type StudioRole } from '../../shared/studio-project';
import { parseConnection, plan, type Connection } from './planning';
import { HttpError, readJson } from '../http/app';
import { ProjectError, ProjectStudio } from '../studio/projects';
import { publicStudioPage, publicStudioScript, publicStudioStyles } from './page';
import { googleLogin, googleSubject, opaqueToken, sameToken, type GoogleConfig } from './google';

const flowCookiePrefix = '__Host-kodexa-google-';
const sessionCookie = '__Host-kodexa-public';
const loginLifetime = 300;
const sessionLifetime = 8 * 3600;
const mutationWindowMs = 60_000;
const mutationLimit = 30;
const maxGoogleExchanges = 16;
type MutationWindow = { count: number; expires: number };
type Flow = { state: string; verifier: string; expires: number };
type Session = { user: string; expires: number };
type Provider = Connection['provider'];
type Preferences = {
  connections: Map<Provider, Connection>;
  assignments: Map<StudioRole, Provider>;
  defaultProvider?: Provider;
};

function isProvider(value: unknown): value is Provider {
  return value === 'openai' || value === 'anthropic' || value === 'gemini';
}
type Team = Partial<Record<StudioRole | 'default', Provider>>;
function readTeam(path: string): Team {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}
function connectionFor(prefs: Preferences | undefined, role: StudioRole, team: Team) {
  const provider = team[role] ?? team.default ?? prefs?.assignments.get(role) ?? prefs?.defaultProvider;
  return provider && prefs?.connections.get(provider);
}

function cookie(name: string, value: string, age: number): string {
  return `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
}
function readCookie(req: IncomingMessage, name: string) {
  return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) ?? '';
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location });
  res.end();
}
function prune<T extends { expires: number }>(entries: Map<string, T>, now: number) {
  for (const [key, entry] of entries) if (entry.expires <= now) entries.delete(key);
}

export function createPublicStudio(options: {
  origin: string;
  dir: string;
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const origin = new URL(options.origin);
  if (origin.protocol !== 'https:' || origin.origin !== options.origin || !options.clientId || !options.clientSecret) {
    throw new Error('Configure a origem HTTPS e as credenciais OAuth do estúdio público.');
  }
  const google: GoogleConfig = {
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUri: origin.origin + '/public/google/callback',
  };
  const flows = new Map<string, Flow>();
  const sessions = new Map<string, Session>();
  const studios = new Map<string, ProjectStudio>();
  const preferences = new Map<string, Preferences>();
  const mutations = new Map<string, MutationWindow>();
  const clock = options.now ?? Date.now;
  let googleExchanges = 0;

  return createServer({
    headersTimeout: 10_000,
    requestTimeout: 15_000,
    connectionsCheckingInterval: 1_000,
    keepAliveTimeout: 5_000,
    maxHeaderSize: 16 * 1024,
  }, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    void route(req, res).catch(error => {
      if (res.headersSent) return res.destroy();
      const code = error instanceof ProjectError || error instanceof HttpError ? error.status : 500;
      json(res, code, { error: code === 500 ? 'Erro interno.' : error.message });
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse) {
    if (req.headers.host !== origin.host || !req.url?.startsWith('/') || req.url.startsWith('//')) {
      return json(res, 400, { error: 'Endereço inválido.' });
    }
    const url = new URL(req.url, origin);
    if (url.origin !== origin.origin) return json(res, 400, { error: 'Endereço inválido.' });
    const method = req.method;
    const now = clock();
    prune(flows, now);
    prune(sessions, now);
    prune(mutations, now);
    const activeUsers = new Set([...sessions.values()].map(session => session.user));
    for (const user of preferences.keys()) if (!activeUsers.has(user)) preferences.delete(user);
    if (method === 'POST' && req.headers.origin !== origin.origin) {
      return json(res, 403, { error: 'Origem não autorizada.' });
    }

    if (method === 'GET' && url.pathname === '/public/health') return json(res, 200, { status: 'ok' });

    if (method === 'GET') {
      const resource = url.pathname === '/public/' ? ['text/html', publicStudioPage] :
        url.pathname === '/public/studio.css' ? ['text/css', publicStudioStyles] :
        url.pathname === '/public/office.js' ? ['text/javascript', readFileSync(new URL('./public-office.js', import.meta.url), 'utf8')] :
        url.pathname === '/public/studio.js' ? ['text/javascript', publicStudioScript] : undefined;
      if (resource) {
        res.setHeader('Content-Security-Policy', "default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
        res.writeHead(200, { 'Content-Type': resource[0] + '; charset=utf-8' });
        res.end(resource[1]);
        return;
      }
    }

    if (method === 'GET' && url.pathname === '/public/google') {
      if (flows.size >= 512) return json(res, 503, { error: 'Tente de novo em alguns minutos.' });
      const flow = googleLogin(google);
      const id = opaqueToken();
      flows.set(id, { state: flow.state, verifier: flow.verifier, expires: now + loginLifetime * 1000 });
      res.setHeader('Set-Cookie', cookie(flowCookiePrefix + flow.state, id, loginLifetime));
      return redirect(res, flow.url.href);
    }

    if (method === 'GET' && url.pathname === '/public/google/callback') {
      const state = url.searchParams.get('state') ?? '';
      const name = flowCookiePrefix + state;
      const id = /^[A-Za-z0-9_-]{43}$/.test(state) ? readCookie(req, name) : '';
      const flow = flows.get(id);
      if (!flow || !sameToken(flow.state, state)) return redirect(res, '/public/?login=expired');
      flows.delete(id);
      res.setHeader('Set-Cookie', cookie(name, '', 0));
      if (url.searchParams.has('error')) return redirect(res, '/public/?login=denied');
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) return redirect(res, '/public/?login=expired');
      if (googleExchanges >= maxGoogleExchanges) {
        res.setHeader('Retry-After', '5');
        return json(res, 503, { error: 'O login está ocupado. Comece novamente em alguns segundos.' });
      }
      googleExchanges++;
      let user: string;
      try {
        user = await googleSubject(google, code, flow.verifier, options.fetcher);
      } catch {
        return redirect(res, '/public/?login=provider');
      } finally {
        googleExchanges--;
      }
      if (sessions.size >= 1024) return json(res, 503, { error: 'Tente de novo mais tarde.' });
      sessions.delete(readCookie(req, sessionCookie));
      const session = opaqueToken();
      sessions.set(session, { user, expires: clock() + sessionLifetime * 1000 });
      res.setHeader('Set-Cookie', [cookie(name, '', 0), cookie(sessionCookie, session, sessionLifetime)]);
      return redirect(res, '/public/');
    }

    // The public process has a positive allowlist and never calls owner routes.
    const action = /^\/public\/projects\/([a-f0-9-]{36})\/(next|approve|team)$/.exec(url.pathname);
    if (!action && !['/public/projects', '/public/logout', '/public/provider'].includes(url.pathname)) {
      return json(res, 404, { error: 'Página não encontrada.' });
    }
    const sessionId = readCookie(req, sessionCookie);
    const session = sessions.get(sessionId);
    if (!session) return json(res, 401, { error: 'Entre com Google.' });
    if (method === 'POST' && url.pathname === '/public/logout') {
      sessions.delete(sessionId);
      if (![...sessions.values()].some(other => other.user === session.user)) preferences.delete(session.user);
      res.setHeader('Set-Cookie', cookie(sessionCookie, '', 0));
      return json(res, 200, { ok: true });
    }

    if (method === 'POST') {
      const limit = mutations.get(session.user) ?? { count: 0, expires: now + mutationWindowMs };
      if (limit.count >= mutationLimit) {
        req.resume();
        res.setHeader('Retry-After', String(Math.ceil((limit.expires - now) / 1000)));
        return json(res, 429, { error: 'Muitas alterações em pouco tempo. Aguarde e tente novamente.' });
      }
      limit.count++;
      mutations.set(session.user, limit);
    }

    if (url.pathname === '/public/provider') {
      let prefs = preferences.get(session.user);
      if (method === 'POST') {
        const body = await readJson(req, 2048) as { provider?: unknown; role?: unknown; disconnect?: unknown; assign?: unknown } | null;
        if (sessions.get(sessionId) !== session || session.expires <= clock()) return json(res, 401, { error: 'Entre com Google.' });
        prefs ??= { connections: new Map(), assignments: new Map() };
        if (body?.disconnect === true) {
          if (!isProvider(body.provider)) throw new ProjectError(400, 'Selecione a IA a desconectar.');
          prefs.connections.delete(body.provider);
          if (prefs.defaultProvider === body.provider) prefs.defaultProvider = undefined;
          for (const [role, provider] of prefs.assignments) if (provider === body.provider) prefs.assignments.delete(role);
        } else if (body?.assign === true) {
          if (!isProvider(body.provider) || !prefs.connections.has(body.provider)) {
            throw new ProjectError(400, 'Conecte o provedor antes de atribuí-lo.');
          }
          if (body.role === 'default') prefs.defaultProvider = body.provider;
          else {
            const role = STAGES.find(([id]) => id === body.role)?.[0];
            if (!role) throw new ProjectError(400, 'Selecione uma etapa válida.');
            prefs.assignments.set(role, body.provider);
          }
        } else {
          const connection = parseConnection(body);
          prefs.connections.set(connection.provider, connection);
          prefs.defaultProvider ??= connection.provider;
        }
        preferences.set(session.user, prefs);
      } else if (method !== 'GET') {
        return json(res, 405, { error: 'Método não permitido.' });
      }
      return json(res, 200, {
        connections: [...(prefs?.connections.values() ?? [])].map(({ provider, model }) => ({ provider, model })),
        defaultProvider: prefs?.defaultProvider ?? null,
        assignments: Object.fromEntries(prefs?.assignments ?? []),
      });
    }
    if (action ? method !== 'POST' : url.pathname !== '/public/projects' || (method !== 'GET' && method !== 'POST')) {
      return json(res, 405, { error: 'Método não permitido.' });
    }
    const teamPath = (id: string) => join(options.dir, session.user, id + '.team.json');
    let studio = studios.get(session.user);
    if (!studio) {
      if (studios.size >= 1024) return json(res, 503, { error: 'Capacidade do estúdio atingida.' });
      studio = new ProjectStudio({
        dir: join(options.dir, session.user),
        env: {},
        run: (project, stage) => {
          const connection = connectionFor(preferences.get(session.user), stage[0], readTeam(teamPath(project.id)));
          if (!connection) throw new ProjectError(409, 'Conecte sua IA para continuar.');
          return plan(connection, project, stage, options.fetcher);
        },
      });
      studios.set(session.user, studio);
    }
    if (method === 'GET') return json(res, 200, studio.info().projects.map(project => ({ ...project, team: readTeam(teamPath(project.id)) })));
    const body = await readJson(req, 16 * 1024);
    if (sessions.get(sessionId) !== session || session.expires <= clock()) return json(res, 401, { error: 'Entre com Google.' });
    if (action?.[2] === 'team') {
      const project = studio.info().projects.find(p => p.id === action[1]);
      if (!project) throw new ProjectError(404, 'Projeto não encontrado.');
      if (project.state === 'running') throw new ProjectError(409, 'Aguarde a etapa terminar.');
      const change = body as { role?: unknown; provider?: unknown } | null;
      const role = change?.role === 'default' ? 'default' : STAGES.find(([id]) => id === change?.role)?.[0];
      if (!role) throw new ProjectError(400, 'Agente inválido.');
      const path = teamPath(project.id);
      const team = readTeam(path);
      if (change?.provider === null) delete team[role];
      else if (isProvider(change?.provider) && preferences.get(session.user)?.connections.has(change.provider)) team[role] = change.provider;
      else throw new ProjectError(400, 'Conecte essa IA em Minha IA para projetos.');
      writeFileSync(path + '.tmp', JSON.stringify(team), { mode: 0o600 });
      renameSync(path + '.tmp', path);
      return json(res, 200, team);
    }
    if (action?.[2] === 'approve') return json(res, 200, studio.approve(action[1], (body as { decision?: unknown } | null)?.decision));
    if (action?.[2] === 'next') {
      const project = studio.info().projects.find(candidate => candidate.id === action[1]);
      if (!project) throw new ProjectError(404, 'Projeto não encontrado.');
      const stage = nextPlanningStages(project)[0];
      if (stage && !connectionFor(preferences.get(session.user), stage[0], readTeam(teamPath(project.id)))) {
        throw new ProjectError(409, 'Conecte e atribua uma IA para executar esta etapa.');
      }
      return json(res, 202, studio.launch(action[1]));
    }
    return json(res, 201, studio.create({ brief: (body as { brief?: unknown } | null)?.brief, research: false }));
  }
}

