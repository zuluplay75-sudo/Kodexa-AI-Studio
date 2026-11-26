import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { parseConnection, plan, type Connection } from './planning';
import { HttpError, readJson } from '../http/app';
import { ProjectError, ProjectStudio } from '../studio/projects';
import { publicStudioPage, publicStudioScript, publicStudioStyles } from './page';
import { googleLogin, googleSubject, opaqueToken, sameToken, type GoogleConfig } from './google';

const flowCookie = '__Host-kodexa-google';
const sessionCookie = '__Host-kodexa-public';
const loginLifetime = 300;
const sessionLifetime = 8 * 3600;
type Flow = { state: string; verifier: string; expires: number };
type Session = { user: string; expires: number };

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
  const connections = new Map<string, Connection>();

  return createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
    const now = Date.now();
    prune(flows, now);
    prune(sessions, now);
    const activeUsers = new Set([...sessions.values()].map(session => session.user));
    for (const user of connections.keys()) if (!activeUsers.has(user)) connections.delete(user);
    if (method === 'POST' && req.headers.origin !== origin.origin) {
      return json(res, 403, { error: 'Origem não autorizada.' });
    }

    if (method === 'GET') {
      const resource = url.pathname === '/public/' ? ['text/html', publicStudioPage] :
        url.pathname === '/public/studio.css' ? ['text/css', publicStudioStyles] :
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
      res.setHeader('Set-Cookie', cookie(flowCookie, id, loginLifetime));
      return redirect(res, flow.url.href);
    }

    if (method === 'GET' && url.pathname === '/public/google/callback') {
      const id = readCookie(req, flowCookie);
      const flow = flows.get(id);
      flows.delete(id);
      res.setHeader('Set-Cookie', cookie(flowCookie, '', 0));
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!flow || !state || !sameToken(flow.state, state) || !code || code.length > 4096) {
        return json(res, 400, { error: 'Autorização inválida ou expirada.' });
      }
      const user = await googleSubject(google, code, flow.verifier, options.fetcher);
      if (sessions.size >= 1024) return json(res, 503, { error: 'Tente de novo mais tarde.' });
      sessions.delete(readCookie(req, sessionCookie));
      const session = opaqueToken();
      sessions.set(session, { user, expires: now + sessionLifetime * 1000 });
      res.setHeader('Set-Cookie', [cookie(flowCookie, '', 0), cookie(sessionCookie, session, sessionLifetime)]);
      return redirect(res, '/public/');
    }

    // The public process has a positive allowlist and never calls owner routes.
    const action = /^\/public\/projects\/([a-f0-9-]{36})\/(next|approve)$/.exec(url.pathname);
    if (!action && !['/public/projects', '/public/logout', '/public/provider'].includes(url.pathname)) {
      return json(res, 404, { error: 'Página não encontrada.' });
    }
    const sessionId = readCookie(req, sessionCookie);
    const session = sessions.get(sessionId);
    if (!session) return json(res, 401, { error: 'Entre com Google.' });
    if (method === 'POST' && url.pathname === '/public/logout') {
      sessions.delete(sessionId);
      if (![...sessions.values()].some(other => other.user === session.user)) connections.delete(session.user);
      res.setHeader('Set-Cookie', cookie(sessionCookie, '', 0));
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/public/provider') {
      if (method === 'POST') {
        const body = await readJson(req, 2048) as { disconnect?: unknown } | null;
        if (body?.disconnect === true) connections.delete(session.user);
        else connections.set(session.user, parseConnection(body));
      } else if (method !== 'GET') {
        return json(res, 405, { error: 'Método não permitido.' });
      }
      const configured = connections.get(session.user);
      return json(res, 200, configured ? { provider: configured.provider, model: configured.model } : null);
    }
    if (action ? method !== 'POST' : url.pathname !== '/public/projects' || (method !== 'GET' && method !== 'POST')) {
      return json(res, 405, { error: 'Método não permitido.' });
    }
    let studio = studios.get(session.user);
    if (!studio) {
      if (studios.size >= 1024) return json(res, 503, { error: 'Capacidade do estúdio atingida.' });
      studio = new ProjectStudio({
        dir: join(options.dir, session.user),
        env: {},
        run: (project, stage) => {
          const connection = connections.get(session.user);
          if (!connection) throw new ProjectError(409, 'Conecte sua IA para continuar.');
          return plan(connection, project, stage, options.fetcher);
        },
      });
      studios.set(session.user, studio);
    }
    if (method === 'GET') return json(res, 200, studio.info().projects);
    const body = await readJson(req, 16 * 1024);
    if (action?.[2] === 'approve') return json(res, 200, studio.approve(action[1], (body as { decision?: unknown } | null)?.decision));
    if (action?.[2] === 'next') {
      if (!connections.has(session.user)) throw new ProjectError(409, 'Conecte sua IA para continuar.');
      return json(res, 202, studio.launch(action[1]));
    }
    return json(res, 201, studio.create({ brief: (body as { brief?: unknown } | null)?.brief, research: false }));
  }
}
