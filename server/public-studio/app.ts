import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextPlanningStages, STAGES, type StudioRole } from '../../shared/studio-project';
import { parseConnection, plan, PROVIDER_LABEL, stageInput, stageSystem } from './planning';
import { chatgptAuthorization, ChatGPTError, exchangeCode, refreshGrant, respond, revokeGrant, type ChatGPTConfig, type PendingAuthorization } from './chatgpt';
import { connectionState, resolveRoute, type Route, type Team } from './routing';
import { ConnectionVault, isLocal, isProvider, LOCAL_PROVIDERS, PROVIDERS, type Credential, type Provider } from './vault';
import { ConnectorError, ConnectorHub } from './connector';
import { HttpError, readJson } from '../http/app';
import { PlanningApiError, ProjectError, ProjectStudio } from '../studio/projects';
import { parsePrefs } from '../../client/src/studio/prefs';
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
type ChatGPTFlow = { user: string; pending: PendingAuthorization; expires: number };
const chatgptCookiePrefix = '__Host-kodexa-chatgpt-';
function readTeam(path: string): Team {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}
const SOURCE_TEXT: Record<Route['source'], string> = {
  'project-agent': 'por escolha deste projeto',
  'project-default': 'pela IA padrão deste projeto',
  'account-agent': 'pela atribuição do agente na conta',
  'account-default': 'pela IA padrão da conta',
  none: '',
};
const STATE_TEXT: Record<string, string> = {
  expired: 'a autorização expirou; reconecte em Configurar estúdio',
  no_permission: 'a conta não liberou o uso para tarefas; reconecte em Configurar estúdio',
  pending_approval: 'a integração aguarda liberação da OpenAI',
  available: 'a IA não está conectada; conecte em Configurar estúdio',
  offline: 'o computador com o Kodexa Conector está desligado ou sem essa ferramenta',
  missing: 'o computador está ligado, mas o Kodexa Conector não tem essa ferramenta (instale-a ou abra o conector com --com-claude)',
};
/** Por que a etapa não pode rodar com a IA escolhida (ou undefined quando pode). Identifica a etapa e a IA. */
function routeProblem(route: Route, stage: string): string | undefined {
  if (!route.provider) return stage + ': nenhuma IA atribuída. Conecte e escolha uma IA em Configurar estúdio.';
  if (route.state === 'connected') return undefined;
  return stage + ' usa ' + PROVIDER_LABEL[route.provider] + ' ' + SOURCE_TEXT[route.source] + ', mas ' + (STATE_TEXT[route.state] ?? 'a IA não está disponível') + '.';
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
/**
 * Arquivos públicos do escritório (logotipo, ilustrações, artes do mapa e o manifest delas): os mesmos do escritório
 * original, em dist/client/assets. Só leitura, só estas extensões, sem sair da pasta e sem ponto inicial.
 */
const ASSET_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
function readAsset(root: string, pathname: string): { type: string; body: Buffer } | undefined {
  const rel = pathname.slice('/assets/'.length);
  if (!/^(?:[a-z0-9][a-z0-9_@.-]*\/)*[a-z0-9][a-z0-9_@.-]*$/i.test(rel) || rel.includes('..')) return undefined;
  const type = ASSET_TYPES[extname(rel).toLowerCase()];
  if (!type) return undefined;
  const base = resolve(root);
  const file = resolve(base, rel);
  if (!file.startsWith(base + sep)) return undefined;
  try {
    if (!statSync(file).isFile()) return undefined;
    return { type, body: readFileSync(file) };
  } catch {
    return undefined;
  }
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
  /** Chave do cofre de credenciais (32 bytes); sem ela, as conexões ficam só em memória. */
  credentialKey?: Buffer;
  /** ChatGPT do cliente: só com a liberação da OpenAI (ver chatgpt.ts); ausente = aguardando liberação. */
  chatgpt?: ChatGPTConfig;
  /** Pasta dos arquivos de /assets/ (padrão: dist/client/assets, ao lado do servidor compilado). */
  assetsDir?: string;
}) {
  const assetsDir = options.assetsDir ?? fileURLToPath(new URL('../client/assets/', import.meta.url));
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
  const vault = new ConnectionVault(options.dir, options.credentialKey);
  const chatgptFlows = new Map<string, ChatGPTFlow>();
  const refreshing = new Map<string, Promise<Credential>>();
  const fetcher = options.fetcher ?? fetch;
  const chatgpt = options.chatgpt;
  const hub = new ConnectorHub(options.dir, () => clock());
  const stateContext = (user: string) => ({ chatgptEnabled: !!chatgpt, local: (tool: 'codex' | 'claude') => hub.status(user, tool) });
  /** A IA tem vínculo com a conta (pode ser escolhida): credencial guardada, ou um computador pareado para as locais. */
  const linked = (user: string, provider: Provider) => isLocal(provider) ? hub.devices(user).length > 0 : !!vault.get(user, provider);
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
    prune(chatgptFlows, now);
    const activeUsers = new Set([...sessions.values()].map(session => session.user));
    for (const user of vault.loadedUsers()) if (!activeUsers.has(user)) vault.forgetIfVolatile(user);
    // O Kodexa Conector não é um navegador: usa token próprio (sem cookie), então não passa pela checagem de Origin.
    const connectorRoute = /^\/public\/connector\/(claim|poll|ack)$/.exec(url.pathname)?.[1];
    if (method === 'POST' && !connectorRoute && req.headers.origin !== origin.origin) {
      return json(res, 403, { error: 'Origem não autorizada.' });
    }
    if (connectorRoute) {
      if (method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });
      if (req.headers.cookie) return json(res, 400, { error: 'O conector não usa cookies.' });
      const body = await readJson(req, connectorRoute === 'ack' ? 64 * 1024 : 4096);
      if (connectorRoute === 'claim') {
        try {
          const claim = body as { code?: unknown; name?: unknown; tools?: { codex?: unknown; claude?: unknown } } | null;
          const { token, user: owner } = hub.claim(claim?.code, claim?.name);
          // Primeiro vínculo da conta: a ferramenta encontrada no computador vira a IA padrão (como ao conectar outra IA).
          const routing = vault.routing(owner);
          const found = claim?.tools?.codex === true ? 'codex-local' : claim?.tools?.claude === true ? 'claude-local' : undefined;
          if (!routing.defaultProvider && found) vault.saveRouting(owner, { ...routing, defaultProvider: found });
          return json(res, 200, { token });
        } catch (error) {
          if (error instanceof ConnectorError) return json(res, 400, { error: error.message });
          throw error;
        }
      }
      const device = hub.authenticate(req.headers.authorization);
      if (!device) return json(res, 401, { error: 'Computador não pareado ou removido. Pareie de novo em Configurar estúdio.' });
      if (connectorRoute === 'ack') return json(res, 200, { ok: hub.ack(device.user, device.deviceId, body) });
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      const wait = (body as { wait?: unknown } | null)?.wait === true ? 10_000 : 0;
      const jobs = await hub.poll(device.user, device.deviceId, (body as { tools?: unknown } | null)?.tools, wait, ac.signal);
      if (ac.signal.aborted) return;
      return json(res, 200, { jobs });
    }

    if (method === 'GET' && url.pathname === '/public/health') return json(res, 200, { status: 'ok' });
    if ((method === 'GET' || method === 'HEAD') && url.pathname.startsWith('/assets/')) {
      const asset = readAsset(assetsDir, url.pathname);
      if (!asset) return json(res, 404, { error: 'Página não encontrada.' });
      res.setHeader('Cache-Control', 'no-cache');
      res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.length });
      return void res.end(method === 'HEAD' ? undefined : asset.body);
    }

    if (method === 'GET') {
      const resource = url.pathname === '/public/' ? ['text/html', '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kodexa AI Studio</title><link rel="stylesheet" href="/public/office.css"><script defer src="/public/office.js"></script><body><header id="brand">Kodexa AI Studio</header><main><a hidden id="login" href="/public/google">Entrar com Google</a><canvas hidden id="office-map" aria-label="Escritório Kodexa"></canvas><button hidden id="logout">Sair</button><p id="status" role="status"></p></main></body></html>'] :
        url.pathname === '/public/office.css' ? ['text/css', readFileSync(new URL('./public-office.css', import.meta.url), 'utf8')] :
        url.pathname === '/public/office.js' ? ['text/javascript', readFileSync(new URL('./public-office.js', import.meta.url), 'utf8')] : undefined;
      if (url.pathname === '/public/kodexa-conector.mjs') {
        // O programa do conector, para baixar e rodar no computador do cliente (node kodexa-conector.mjs).
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Disposition': 'attachment; filename="kodexa-conector.mjs"' });
        return void res.end(readFileSync(new URL('./kodexa-conector.mjs', import.meta.url)));
      }
      if (resource) {
        res.setHeader('Content-Security-Policy', "default-src 'none'; connect-src 'self'; font-src data:; img-src 'self' data:; script-src 'self'; style-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
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
    if (!action && !['/public/projects', '/public/logout', '/public/provider', '/public/preferences', '/public/chatgpt', '/public/chatgpt/callback', '/public/connector', '/public/connector/pair', '/public/connector/revoke'].includes(url.pathname)) {
      return json(res, 404, { error: 'Página não encontrada.' });
    }
    const sessionId = readCookie(req, sessionCookie);
    const session = sessions.get(sessionId);
    if (!session) {
      // Retorno do ChatGPT sem sessão do Kodexa (expirou no meio): volta ao login, sem aceitar a autorização.
      if (url.pathname === '/public/chatgpt/callback') return redirect(res, '/public/?chatgpt=session');
      return json(res, 401, { error: 'Entre com Google.' });
    }
    const user = session.user;
    if (method === 'POST' && url.pathname === '/public/logout') {
      sessions.delete(sessionId);
      if (![...sessions.values()].some(other => other.user === user)) vault.forgetIfVolatile(user);
      res.setHeader('Set-Cookie', cookie(sessionCookie, '', 0));
      return json(res, 200, { ok: true });
    }

    // ChatGPT do cliente: começa a autorização a partir da sessão Kodexa (GET de navegação, sem efeito além do fluxo).
    if (method === 'GET' && url.pathname === '/public/chatgpt') {
      if (!chatgpt) return redirect(res, '/public/?chatgpt=pending');
      // Limite global e por conta: uma conta não ocupa as autorizações em andamento de todas as outras.
      if (chatgptFlows.size >= 512 || [...chatgptFlows.values()].filter(flow => flow.user === user).length >= 5) return redirect(res, '/public/?chatgpt=busy');
      const { url: target, pending } = chatgptAuthorization(chatgpt);
      const id = opaqueToken();
      chatgptFlows.set(id, { user, pending, expires: now + loginLifetime * 1000 });
      res.setHeader('Set-Cookie', cookie(chatgptCookiePrefix + pending.state, id, loginLifetime));
      return redirect(res, target.href);
    }
    if (method === 'GET' && url.pathname === '/public/chatgpt/callback') {
      const state = url.searchParams.get('state') ?? '';
      const name = chatgptCookiePrefix + state;
      const id = /^[A-Za-z0-9_-]{43}$/.test(state) ? readCookie(req, name) : '';
      const flow = chatgptFlows.get(id);
      // A transação precisa ser desta sessão: um retorno começado por outra conta não vincula nada aqui.
      if (!chatgpt || !flow || flow.user !== user || !sameToken(flow.pending.state, state)) return redirect(res, '/public/?chatgpt=expired');
      chatgptFlows.delete(id);
      res.setHeader('Set-Cookie', cookie(name, '', 0));
      if (url.searchParams.has('error')) return redirect(res, '/public/?chatgpt=cancelled');
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) return redirect(res, '/public/?chatgpt=expired');
      try {
        const grant = await exchangeCode(chatgpt, code, flow.pending, clock(), fetcher);
        if (!sessions.has(sessionId)) return redirect(res, '/public/?chatgpt=session');
        if (!grant.planUsage) {
          // Identidade sem permissão de uso do plano: não guarda tokens que não servem para tarefas.
          void revokeGrant(chatgpt, grant.refresh, fetcher);
          vault.set(user, { provider: 'chatgpt', model: chatgpt.model, linkedAt: clock(), noPermission: true });
          return redirect(res, '/public/?chatgpt=no_permission');
        }
        const previous = vault.get(user, 'chatgpt');
        vault.set(user, { provider: 'chatgpt', model: chatgpt.model, linkedAt: clock(), oauth: { access: grant.access, refresh: grant.refresh, expiresAt: grant.expiresAt, scope: grant.scope, account: grant.account } });
        if (previous?.oauth && previous.oauth.refresh !== grant.refresh) void revokeGrant(chatgpt, previous.oauth.refresh, fetcher);
        const routing = vault.routing(user);
        if (!routing.defaultProvider) vault.saveRouting(user, { ...routing, defaultProvider: 'chatgpt' });
        return redirect(res, '/public/?chatgpt=connected');
      } catch (error) {
        return redirect(res, '/public/?chatgpt=' + (error instanceof ChatGPTError && error.kind === 'config' ? 'config' : 'failed'));
      }
    }

    if (method === 'POST') {
      const limit = mutations.get(user) ?? { count: 0, expires: now + mutationWindowMs };
      if (limit.count >= mutationLimit) {
        req.resume();
        res.setHeader('Retry-After', String(Math.ceil((limit.expires - now) / 1000)));
        return json(res, 429, { error: 'Muitas alterações em pouco tempo. Aguarde e tente novamente.' });
      }
      limit.count++;
      mutations.set(user, limit);
    }
    const stillSignedIn = () => sessions.get(sessionId) === session && session.expires > clock();

    if (url.pathname === '/public/preferences') {
      const dir = join(options.dir, user);
      const file = join(dir, 'office-prefs');
      if (method === 'POST') {
        const prefs = parsePrefs(JSON.stringify(await readJson(req, 32768)));
        if (!prefs) throw new ProjectError(400, 'Configuração inválida.');
        if (!stillSignedIn()) return json(res, 401, {error:'Entre com Google.'});
        mkdirSync(dir, {recursive:true});
        writeFileSync(file+'.tmp', JSON.stringify(prefs), {mode:0o600});
        renameSync(file+'.tmp', file);
        return json(res, 200, {ok:true});
      }
      if(method !== 'GET') return json(res,405,{error:'Método não permitido.'});
      try { return json(res,200,parsePrefs(readFileSync(file,'utf8'))); }
      catch(error){if((error as NodeJS.ErrnoException).code !== 'ENOENT')throw error;return json(res,200,null);}
    }

    if (url.pathname.startsWith('/public/connector')) {
      if (method === 'POST') {
        const body = await readJson(req, 1024) as { id?: unknown } | null;
        if (!stillSignedIn()) return json(res, 401, { error: 'Entre com Google.' });
        if (url.pathname === '/public/connector/pair') {
          try {
            const { code, expiresAt } = hub.pairCode(user);
            return json(res, 200, { code, expiresAt, server: origin.origin });
          } catch (error) {
            if (error instanceof ConnectorError) return json(res, 409, { error: error.message });
            throw error;
          }
        }
        if (url.pathname === '/public/connector/revoke') {
          if (!hub.revoke(user, body?.id)) throw new ProjectError(404, 'Computador não encontrado.');
        } else return json(res, 405, { error: 'Método não permitido.' });
      } else if (method !== 'GET' || url.pathname !== '/public/connector') return json(res, 405, { error: 'Método não permitido.' });
      return json(res, 200, { devices: hub.view(user) });
    }

    if (url.pathname === '/public/provider') {
      if (method === 'POST') {
        const body = await readJson(req, 2048) as { provider?: unknown; role?: unknown; disconnect?: unknown; assign?: unknown } | null;
        if (!stillSignedIn()) return json(res, 401, { error: 'Entre com Google.' });
        const routing = vault.routing(user);
        if (body?.disconnect === true) {
          if (!isProvider(body.provider)) throw new ProjectError(400, 'Selecione a IA a desconectar.');
          const credential = vault.get(user, body.provider);
          vault.delete(user, body.provider);
          if (credential?.oauth && chatgpt) void revokeGrant(chatgpt, credential.oauth.refresh, fetcher);
          // A escolha da IA (padrão e por agente) continua salva: o painel mostra "disponível para conectar".
        } else if (body?.assign === true) {
          if (body.role !== 'default' && !STAGES.some(([id]) => id === body.role)) throw new ProjectError(400, 'Selecione uma etapa válida.');
          if (body.provider === null) {
            if (body.role === 'default') delete routing.defaultProvider;
            else delete routing.assignments[body.role as StudioRole];
          } else {
            if (!isProvider(body.provider) || !linked(user, body.provider)) throw new ProjectError(400, 'Conecte o provedor antes de atribuí-lo.');
            if (body.role === 'default') routing.defaultProvider = body.provider;
            else routing.assignments[body.role as StudioRole] = body.provider;
          }
          vault.saveRouting(user, routing);
        } else {
          const connection = parseConnection(body);
          vault.set(user, { provider: connection.provider, model: connection.model, key: connection.key, linkedAt: clock() });
          if (!routing.defaultProvider) vault.saveRouting(user, { ...routing, defaultProvider: connection.provider });
        }
      } else if (method !== 'GET') {
        return json(res, 405, { error: 'Método não permitido.' });
      }
      return json(res, 200, providerInfo(user));
    }
    if (action ? method !== 'POST' : url.pathname !== '/public/projects' || (method !== 'GET' && method !== 'POST')) {
      return json(res, 405, { error: 'Método não permitido.' });
    }
    const teamPath = (id: string) => join(options.dir, user, id + '.team.json');
    const routeOf = (projectId: string, role: StudioRole) =>
      resolveRoute(role, readTeam(teamPath(projectId)), vault.routing(user), vault.credentials(user), stateContext(user));
    let studio = studios.get(user);
    if (!studio) {
      if (studios.size >= 1024) return json(res, 503, { error: 'Capacidade do estúdio atingida.' });
      studio = new ProjectStudio({
        dir: join(options.dir, user),
        env: {},
        // A IA é resolvida a cada etapa, pela conta dona do projeto (nunca por um id vindo do navegador).
        run: (project, stage) => runStage(user, routeOf(project.id, stage[0]), project, stage),
      });
      studios.set(user, studio);
    }
    if (method === 'GET') {
      return json(res, 200, studio.info().projects.map(project => ({
        ...project,
        team: readTeam(teamPath(project.id)),
        routing: Object.fromEntries(STAGES.map(([role]) => [role, routeOf(project.id, role)])),
      })));
    }
    const body = await readJson(req, 16 * 1024);
    if (!stillSignedIn()) return json(res, 401, { error: 'Entre com Google.' });
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
      else if (isProvider(change?.provider) && linked(user, change.provider)) team[role] = change.provider;
      else throw new ProjectError(400, 'Conecte essa IA em Configurar estúdio antes de escolhê-la.');
      writeFileSync(path + '.tmp', JSON.stringify(team), { mode: 0o600 });
      renameSync(path + '.tmp', path);
      return json(res, 200, team);
    }
    if (action?.[2] === 'approve') return json(res, 200, studio.approve(action[1], (body as { decision?: unknown } | null)?.decision));
    if (action?.[2] === 'next') {
      const project = studio.info().projects.find(candidate => candidate.id === action[1]);
      if (!project) throw new ProjectError(404, 'Projeto não encontrado.');
      const stage = nextPlanningStages(project)[0];
      const problem = stage && routeProblem(routeOf(project.id, stage[0]), stage[1]);
      if (problem) throw new ProjectError(409, problem);
      return json(res, 202, studio.launch(action[1]));
    }
    return json(res, 201, studio.create({ brief: (body as { brief?: unknown } | null)?.brief, research: false }));
  }

  /** O que o painel mostra das conexões desta conta: estado, modelo e conta vinculada. Nunca chaves nem tokens. */
  function providerInfo(user: string) {
    const credentials = vault.credentials(user);
    const routing = vault.routing(user);
    return {
      persistent: vault.persistent,
      providers: PROVIDERS.map(provider => {
        const credential = credentials.get(provider);
        return {
          provider,
          state: connectionState(provider, credential, stateContext(user)),
          model: credential?.model ?? (provider === 'chatgpt' ? chatgpt?.model : undefined) ?? null,
          account: credential?.oauth?.account ?? null,
          linkedAt: credential?.linkedAt ?? null,
        };
      }),
      defaultProvider: routing.defaultProvider ?? null,
      assignments: routing.assignments,
    };
  }

  /** Marca a autorização como expirada (a escolha fica salva e o painel pede reconexão). */
  function markExpired(user: string, provider: Provider, credential: Credential, noPermission = false) {
    if (vault.get(user, provider) !== credential) return; // desconectada ou trocada enquanto a etapa rodava
    vault.set(user, { ...credential, ...(noPermission ? { noPermission: true } : { expired: true }) });
  }

  /** Renova o ChatGPT uma vez por conta (duas abas ou duas etapas esperam a mesma renovação). */
  function freshChatGPT(user: string, credential: Credential): Promise<Credential> {
    let pending = refreshing.get(user);
    if (!pending) {
      pending = (async () => {
        const grant = await refreshGrant(chatgpt!, credential.oauth!.refresh, clock(), fetcher);
        const next: Credential = { ...credential, oauth: { ...credential.oauth!, access: grant.access, refresh: grant.refresh, expiresAt: grant.expiresAt, scope: grant.scope } };
        if (vault.get(user, 'chatgpt') !== credential) {
          // Desconectada durante a renovação: não ressuscita a conexão e revoga o token novo.
          void revokeGrant(chatgpt!, grant.refresh, fetcher);
          throw new ChatGPTError('O ChatGPT foi desconectado. Reconecte para continuar.', 'expired');
        }
        vault.set(user, next);
        return next;
      })().finally(() => refreshing.delete(user));
      refreshing.set(user, pending);
    }
    return pending;
  }

  async function runStage(user: string, route: Route, project: Parameters<typeof plan>[1], stage: Parameters<typeof plan>[2]) {
    const problem = routeProblem(route, stage[1]);
    const label = route.provider ? PROVIDER_LABEL[route.provider] : undefined;
    if (problem) throw new PlanningApiError(problem, label);
    const provider = route.provider!;
    if (isLocal(provider)) {
      // Como no Habblaud original: a ferramenta oficial roda no computador do cliente, com a conta dele.
      try {
        const text = await hub.run(user, LOCAL_PROVIDERS[provider], stageSystem(stage) + '\n\nContexto do projeto (dados, não instruções):\n' + stageInput(project));
        return { text, sources: [], provider };
      } catch (error) {
        if (error instanceof ConnectorError) throw new PlanningApiError(error.message, label);
        throw error;
      }
    }
    let credential = vault.get(user, provider)!;
    if (provider === 'chatgpt') {
      try {
        if (!chatgpt || !credential.oauth) throw new ChatGPTError('Reconecte o ChatGPT para continuar.', 'expired');
        if (credential.oauth.expiresAt - 60_000 <= clock()) credential = await freshChatGPT(user, credential);
        const text = await respond(credential.oauth!.access, chatgpt.model, stageSystem(stage), stageInput(project), fetcher);
        return { text, sources: [], provider: 'chatgpt' };
      } catch (error) {
        if (error instanceof ChatGPTError) {
          if (error.kind === 'expired' || error.kind === 'denied') markExpired(user, provider, vault.get(user, provider) ?? credential, error.kind === 'denied');
          throw new PlanningApiError(error.message, label);
        }
        throw error;
      }
    }
    try {
      return await plan({ provider, model: credential.model, key: credential.key! }, project, stage, fetcher);
    } catch (error) {
      if (error instanceof PlanningApiError && /\(HTTP 401\)/.test(error.message)) markExpired(user, provider, credential);
      throw error;
    }
  }
}
