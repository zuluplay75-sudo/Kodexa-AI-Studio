// Conexões de IA dos clientes e atribuição por agente, com provedores SIMULADOS (nenhuma chamada real, nenhuma
// cobrança): Google (login do Kodexa), ChatGPT (OAuth + Responses API em stream), Gemini e OpenAI por chave.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicStudio } from './app';
import { CHATGPT_JWKS, CHATGPT_TOKEN, PLAN_SCOPE, type ChatGPTConfig } from './chatgpt';

const ORIGIN = 'https://studio.example.test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const CHATGPT: ChatGPTConfig = { clientId: 'oaiapp_teste', model: 'modelo-do-plano', redirectUri: ORIGIN + '/public/chatgpt/callback', hostId: 'kodexa-teste' };

function idToken(claims: Record<string, unknown>): string {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return head + '.' + body + '.' + sign('RSA-SHA256', Buffer.from(head + '.' + body), privateKey).toString('base64url');
}
function sse(events: unknown[]): Response {
  return new Response(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}

/** Comportamento do "ChatGPT" simulado; cada teste ajusta o que precisa. */
type Fake = {
  scope: string;
  nonceFor: Map<string, string>;
  refreshCalls: number;
  refreshError?: string;
  revoked: string[];
  responses: (init: RequestInit) => Promise<Response> | Response;
  calls: { url: string; auth?: string; body?: string }[];
};

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function startStudio(opts: { chatgpt?: boolean; credentialKey?: Buffer; dir?: string; now?: () => number } = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'kodexa-conn-'));
  if (!opts.dir) closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const fake: Fake = {
    scope: 'openid email offline_access resource.invoke ' + PLAN_SCOPE,
    nonceFor: new Map(),
    refreshCalls: 0,
    revoked: [],
    responses: () => sse([{ type: 'response.output_text.delta', delta: 'Plano pelo ChatGPT do cliente' }, { type: 'response.completed', response: { status: 'completed' } }]),
    calls: [],
  };
  let rotation = 0;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get('authorization') ?? undefined;
    fake.calls.push({ url, auth, body: typeof init?.body === 'string' ? init.body : init?.body?.toString() });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: (init?.body as URLSearchParams).get('code') });
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: auth?.slice(7) });
    if (url === CHATGPT_TOKEN) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get('grant_type') === 'refresh_token') {
        fake.refreshCalls++;
        await new Promise((r) => setTimeout(r, 20));
        if (fake.refreshError) return Response.json({ error: fake.refreshError }, { status: 400 });
        rotation++;
        return Response.json({ access_token: 'acesso-renovado-' + rotation, refresh_token: 'renovacao-' + rotation, expires_in: 3600, scope: fake.scope });
      }
      const code = form.get('code')!;
      expect(form.get('code_verifier')).toMatch(/^[\w-]{43}$/);
      return Response.json({
        access_token: 'acesso-' + code, refresh_token: 'renovacao-' + code, expires_in: 3600, scope: fake.scope,
        id_token: idToken({ iss: 'https://auth.openai.com', aud: CHATGPT.clientId, sub: 'oa-' + code, nonce: fake.nonceFor.get(code), exp: Math.floor(Date.now() / 1000) + 86_400, email: code + '@exemplo.test', email_verified: true }),
      });
    }
    if (url === CHATGPT_JWKS) return Response.json({ keys: [JWK] });
    if (url === 'https://auth.openai.com/.well-known/openid-configuration') return Response.json({ revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' });
    if (url === 'https://auth.openai.com/api/accounts/oauth/revoke') {
      fake.revoked.push(new URLSearchParams(String(init?.body)).get('token')!);
      return new Response(null, { status: 200 });
    }
    if (url === 'https://api.openai.com/v1/responses' && auth?.startsWith('Bearer acesso')) return fake.responses(init!);
    if (url === 'https://api.openai.com/v1/responses') return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Plano OpenAI por chave' }] }] });
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      if (new Headers(init?.headers).get('x-goog-api-key') === 'gemini-sem-cota-123') return new Response('{}', { status: 429 });
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Plano Gemini' }] } }] });
    }
    throw new Error('Chamada inesperada: ' + url);
  });
  const server = createPublicStudio({
    origin: ORIGIN, dir, clientId: 'g', clientSecret: 'g', fetcher, now: opts.now,
    credentialKey: opts.credentialKey, chatgpt: opts.chatgpt ? CHATGPT : undefined,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  const close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  closers.push(close);

  const request = (path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) =>
    new Promise<{ status: number; location: string | null; cookies: string[]; json: () => any }>((resolve, reject) => {
      const req = httpRequest({
        hostname: '127.0.0.1', port, path, method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: { Host: new URL(ORIGIN).host, ...(init.cookie ? { Cookie: init.cookie } : {}), ...(init.body === undefined ? {} : { Origin: ORIGIN, 'Content-Type': 'application/json' }) },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          const setCookie = res.headers['set-cookie'] ?? [];
          resolve({ status: res.statusCode!, location: (res.headers.location as string) ?? null, cookies: setCookie.map((c) => c.split(';')[0]), json: () => JSON.parse(text) });
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(init.body === undefined ? undefined : JSON.stringify(init.body));
    });

  async function login(googleCode: string): Promise<string> {
    const start = await request('/public/google');
    const state = new URL(start.location!).searchParams.get('state')!;
    const back = await request('/public/google/callback?' + new URLSearchParams({ code: googleCode, state }), { cookie: start.cookies[0] });
    return back.cookies[1];
  }
  /** Começa a autorização do ChatGPT na sessão `session` e devolve o retorno simulado (sem segui-lo). */
  async function chatgptStart(session: string) {
    const start = await request('/public/chatgpt', { cookie: session });
    if (!start.location?.startsWith('https://auth.openai.com/')) return { start, params: undefined, flowCookie: undefined };
    const params = new URL(start.location).searchParams;
    return { start, params, flowCookie: start.cookies[0] };
  }
  async function connectChatGPT(session: string, code: string) {
    const { params, flowCookie } = await chatgptStart(session);
    fake.nonceFor.set(code, params!.get('nonce')!);
    return request('/public/chatgpt/callback?' + new URLSearchParams({ code, state: params!.get('state')! }), { cookie: session + '; ' + flowCookie });
  }
  const provider = async (session: string) => (await request('/public/provider', { cookie: session })).json();
  const stateOf = async (session: string, id: string) => (await provider(session)).providers.find((p: { provider: string }) => p.provider === id);
  const projects = async (session: string) => (await request('/public/projects', { cookie: session })).json();
  const project = async (session: string, id: string) => (await projects(session)).find((p: { id: string }) => p.id === id);
  const createProject = async (session: string, brief: string) => (await request('/public/projects', { cookie: session, body: { brief, research: false } })).json();
  async function runNext(session: string, id: string, until: (p: any) => boolean) {
    const started = await request('/public/projects/' + id + '/next', { cookie: session, body: {} });
    if (started.status !== 202) return started;
    await vi.waitFor(async () => expect(until(await project(session, id))).toBe(true), { timeout: 3000 });
    return started;
  }
  return { dir, fake, fetcher, request, login, chatgptStart, connectChatGPT, provider, stateOf, projects, project, createProject, runNext, close };
}

describe('conexões de IA do cliente', () => {
  it('primeira entrada: nenhuma IA conectada, ChatGPT aguardando liberação e nenhuma etapa roda', async () => {
    const s = await startStudio();
    const ana = await s.login('ana');
    const info = await s.provider(ana);
    expect(info.defaultProvider).toBeNull();
    expect(info.providers.map((p: { provider: string; state: string }) => [p.provider, p.state])).toEqual([
      ['chatgpt', 'pending_approval'], ['openai', 'available'], ['anthropic', 'available'], ['gemini', 'available'],
    ]);
    // Sem liberação não há fluxo: o botão do painel nem aparece, e a rota não leva à OpenAI.
    expect((await s.request('/public/chatgpt', { cookie: ana })).location).toBe('/public/?chatgpt=pending');
    const p = await s.createProject(ana, 'Projeto sem IA — briefing de teste');
    const blocked = await s.request('/public/projects/' + p.id + '/next', { cookie: ana, body: {} });
    expect(blocked.status).toBe(409);
    expect(blocked.json().error).toContain('Kodexa Scout: nenhuma IA atribuída');
    expect((await s.project(ana, p.id)).routing.scout).toEqual({ provider: null, source: 'none', state: 'none' });
  });

  it('ChatGPT liberado: autorização com state, PKCE e nonce; vínculo à conta; tarefa executada no plano; tokens nunca saem', async () => {
    const s = await startStudio({ chatgpt: true });
    const ana = await s.login('ana');
    const { params } = await s.chatgptStart(ana);
    expect(params!.get('code_challenge_method')).toBe('S256');
    expect(params!.get('scope')).toContain(PLAN_SCOPE);
    expect(params!.get('scope')).toContain('offline_access');
    expect(params!.get('resource')).toBe('https://api.openai.com/v1');
    expect(params!.get('redirect_uri')).toBe(ORIGIN + '/public/chatgpt/callback');
    expect(params!.get('nonce')).toMatch(/^[\w-]{43}$/);
    const back = await s.connectChatGPT(ana, 'ana');
    expect(back.location).toBe('/public/?chatgpt=connected');
    const info = await s.provider(ana);
    expect(info.defaultProvider).toBe('chatgpt'); // conta nova: o ChatGPT vira a padrão ao conectar
    expect(info.providers[0]).toMatchObject({ provider: 'chatgpt', state: 'connected', account: 'ana@exemplo.test', model: 'modelo-do-plano' });
    expect(JSON.stringify(info)).not.toMatch(/acesso-|renovacao-/);
    const p = await s.createProject(ana, 'App da oficina — briefing de teste');
    await s.runNext(ana, p.id, (x) => x.state === 'approval');
    const done = await s.project(ana, p.id);
    expect(done.stages[0]).toMatchObject({ role: 'scout', provider: 'chatgpt', text: 'Plano pelo ChatGPT do cliente' });
    expect(done.routing.scout).toEqual({ provider: 'chatgpt', source: 'account-default', state: 'connected' });
    const call = s.fake.calls.find((c) => c.url === 'https://api.openai.com/v1/responses')!;
    expect(call.auth).toBe('Bearer acesso-ana');
    expect(JSON.parse(call.body!)).toMatchObject({ model: 'modelo-do-plano', store: false, stream: true });
    expect(JSON.stringify(await s.projects(ana))).not.toMatch(/acesso-|renovacao-/);
    // Nada de token em arquivo sem cofre (modo só memória) nem no JSON dos projetos.
    for (const f of readdirSync(join(s.dir), { recursive: true }) as string[]) {
      if (!f.endsWith('.json')) continue;
      expect(readFileSync(join(s.dir, f), 'utf8')).not.toMatch(/acesso-|renovacao-/);
    }
    // No máximo 5 autorizações em andamento por conta (a do começo do teste ficou pendente: é a 1ª).
    for (let i = 0; i < 4; i++) expect((await s.request('/public/chatgpt', { cookie: ana })).location).toMatch(/^https:\/\/auth\.openai\.com\//);
    expect((await s.request('/public/chatgpt', { cookie: ana })).location).toBe('/public/?chatgpt=busy');
    expect((await s.request('/public/chatgpt', { cookie: await s.login('bia') })).location).toMatch(/^https:\/\/auth\.openai\.com\//);
  });

  it('cliente existente com Gemini mantém a padrão ao conectar o ChatGPT', async () => {
    const s = await startStudio({ chatgpt: true });
    const bia = await s.login('bia');
    await s.request('/public/provider', { cookie: bia, body: { provider: 'gemini', model: 'gemini-teste', key: 'gemini-chave-123' } });
    await s.connectChatGPT(bia, 'bia');
    expect((await s.provider(bia)).defaultProvider).toBe('gemini');
  });

  it('autorização cancelada, sem permissão de uso do plano e retorno de outra conta não vinculam nada', async () => {
    const s = await startStudio({ chatgpt: true });
    const ana = await s.login('ana');
    const bia = await s.login('bia');
    // Cancelada na OpenAI.
    const c = await s.chatgptStart(ana);
    const cancelled = await s.request('/public/chatgpt/callback?' + new URLSearchParams({ error: 'access_denied', state: c.params!.get('state')! }), { cookie: ana + '; ' + c.flowCookie });
    expect(cancelled.location).toBe('/public/?chatgpt=cancelled');
    expect((await s.stateOf(ana, 'chatgpt')).state).toBe('available');
    // Fluxo começado pela Ana e concluído na sessão da Bia (mesmo com o cookie do fluxo): recusado.
    const a = await s.chatgptStart(ana);
    s.fake.nonceFor.set('ana', a.params!.get('nonce')!);
    const crossed = await s.request('/public/chatgpt/callback?' + new URLSearchParams({ code: 'ana', state: a.params!.get('state')! }), { cookie: bia + '; ' + a.flowCookie });
    expect(crossed.location).toBe('/public/?chatgpt=expired');
    expect((await s.stateOf(bia, 'chatgpt')).state).toBe('available');
    expect((await s.stateOf(ana, 'chatgpt')).state).toBe('available');
    // Identidade confirmada, mas sem o escopo do plano: "sem permissão", tokens revogados e não guardados.
    s.fake.scope = 'openid email offline_access';
    expect((await s.connectChatGPT(ana, 'ana')).location).toBe('/public/?chatgpt=no_permission');
    expect((await s.stateOf(ana, 'chatgpt')).state).toBe('no_permission');
    await vi.waitFor(() => expect(s.fake.revoked).toContain('renovacao-ana'));
    expect((await s.request('/public/provider', { cookie: ana, body: { assign: true, role: 'scout', provider: 'chatgpt' } })).status).toBe(200);
    const p = await s.createProject(ana, 'Projeto — briefing de teste');
    const blocked = await s.request('/public/projects/' + p.id + '/next', { cookie: ana, body: {} });
    expect(blocked.json().error).toBe('Kodexa Scout usa ChatGPT pela atribuição do agente na conta, mas a conta não liberou o uso para tarefas; reconecte em Configurar estúdio.');
  });

  it('autorização expirada: renova uma vez para duas etapas simultâneas; refresh recusado pede reconexão e mantém a escolha', async () => {
    let now = Date.now();
    const s = await startStudio({ chatgpt: true, now: () => now });
    const ana = await s.login('ana');
    await s.connectChatGPT(ana, 'ana');
    const one = await s.createProject(ana, 'Projeto um — briefing de teste');
    const two = await s.createProject(ana, 'Projeto dois — briefing de teste');
    now += 3600_000; // access token vencido
    await Promise.all([
      s.runNext(ana, one.id, (x) => x.state === 'approval'),
      s.runNext(ana, two.id, (x) => x.state === 'approval'),
    ]);
    expect(s.fake.refreshCalls).toBe(1);
    expect(s.fake.calls.filter((c) => c.url.endsWith('/responses')).every((c) => c.auth === 'Bearer acesso-renovado-1')).toBe(true);
    now += 3600_000;
    s.fake.refreshError = 'refresh_token_expired';
    await s.request('/public/projects/' + one.id + '/approve', { cookie: ana, body: { decision: 'Seguir' } });
    await s.runNext(ana, one.id, (x) => x.state === 'failed');
    const failed = await s.project(ana, one.id);
    expect(failed.failedRoles).toEqual(['manager']);
    expect(failed.error).toContain('Kodexa Manager (ChatGPT): Autorização do ChatGPT expirada');
    expect(failed.stages.map((x: { role: string }) => x.role)).toEqual(['scout']); // etapa concluída preservada
    expect((await s.stateOf(ana, 'chatgpt')).state).toBe('expired');
    expect((await s.provider(ana)).defaultProvider).toBe('chatgpt'); // a escolha continua salva
    const again = await s.request('/public/projects/' + one.id + '/next', { cookie: ana, body: {} });
    expect(again.json().error).toBe('Kodexa Manager usa ChatGPT pela IA padrão da conta, mas a autorização expirou; reconecte em Configurar estúdio.');
    // Reconectar retoma a etapa interrompida.
    s.fake.refreshError = undefined;
    const reconnected = await s.connectChatGPT(ana, 'ana2');
    expect(reconnected.location).toBe('/public/?chatgpt=connected');
    const resumed = await s.runNext(ana, one.id, (x) => x.state === 'ready');
    expect(resumed.status, JSON.stringify(resumed.json())).toBe(202);
    expect((await s.project(ana, one.id)).stages.map((x: { role: string }) => x.role)).toEqual(['scout', 'manager']);
  });

  it('limite do plano: a etapa falha identificada, a conexão continua e a retomada conclui; sem troca de provedor', async () => {
    const s = await startStudio({ chatgpt: true });
    const ana = await s.login('ana');
    await s.request('/public/provider', { cookie: ana, body: { provider: 'gemini', model: 'gemini-teste', key: 'gemini-chave-123' } });
    await s.connectChatGPT(ana, 'ana');
    await s.request('/public/provider', { cookie: ana, body: { assign: true, role: 'default', provider: 'chatgpt' } });
    const p = await s.createProject(ana, 'Projeto — briefing de teste');
    s.fake.responses = () => Response.json({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, { status: 429 });
    await s.runNext(ana, p.id, (x) => x.state === 'failed');
    const failed = await s.project(ana, p.id);
    expect(failed.error).toContain('Kodexa Scout (ChatGPT): Limite de uso do plano ChatGPT atingido');
    expect((await s.stateOf(ana, 'chatgpt')).state).toBe('connected');
    expect(s.fake.calls.some((c) => c.url.startsWith('https://generativelanguage'))).toBe(false); // não trocou para o Gemini
    s.fake.responses = () => sse([{ type: 'response.output_text.delta', delta: 'Depois do limite' }, { type: 'response.completed' }]);
    await s.runNext(ana, p.id, (x) => x.state === 'approval');
    expect((await s.project(ana, p.id)).stages[0].text).toBe('Depois do limite');
  });

  it('limite em chave de API (Gemini 429) também fica na etapa, com o nome da IA do cliente', async () => {
    const s = await startStudio();
    const ana = await s.login('ana');
    await s.request('/public/provider', { cookie: ana, body: { provider: 'gemini', model: 'gemini-teste', key: 'gemini-sem-cota-123' } });
    const p = await s.createProject(ana, 'Projeto — briefing de teste');
    await s.runNext(ana, p.id, (x) => x.state === 'failed');
    expect((await s.project(ana, p.id)).error).toContain('Kodexa Scout (Gemini (chave de API)): Cota ou limite de uso do Gemini atingido');
  });

  it('IA do agente muda só no projeto escolhido; outra conta não vê nem altera', async () => {
    const s = await startStudio({ chatgpt: true });
    const ana = await s.login('ana');
    const bia = await s.login('bia');
    await s.connectChatGPT(ana, 'ana');
    await s.request('/public/provider', { cookie: ana, body: { provider: 'gemini', model: 'gemini-teste', key: 'gemini-chave-123' } });
    const a = await s.createProject(ana, 'Projeto A — briefing de teste');
    const b = await s.createProject(ana, 'Projeto B — briefing de teste');
    expect((await s.request('/public/projects/' + a.id + '/team', { cookie: ana, body: { role: 'scout', provider: 'gemini' } })).status).toBe(200);
    expect((await s.request('/public/projects/' + b.id + '/team', { cookie: ana, body: { role: 'default', provider: 'chatgpt' } })).status).toBe(200);
    expect((await s.project(ana, a.id)).routing.scout).toEqual({ provider: 'gemini', source: 'project-agent', state: 'connected' });
    expect((await s.project(ana, a.id)).routing.dev).toEqual({ provider: 'chatgpt', source: 'account-default', state: 'connected' });
    expect((await s.project(ana, b.id)).routing.scout).toEqual({ provider: 'chatgpt', source: 'project-default', state: 'connected' });
    // A outra conta: o projeto não existe para ela, e um id de usuário no corpo é ignorado.
    expect((await s.request('/public/projects/' + a.id + '/team', { cookie: bia, body: { role: 'scout', provider: 'chatgpt', user: 'ana' } })).status).toBe(404);
    expect((await s.request('/public/projects/' + a.id + '/next', { cookie: bia, body: { user: 'ana' } })).status).toBe(404);
    expect(await s.projects(bia)).toEqual([]);
    expect((await s.stateOf(bia, 'chatgpt')).state).toBe('available');
    expect((await s.request('/public/provider', { cookie: bia, body: { assign: true, role: 'scout', provider: 'chatgpt', user: 'ana' } })).status).toBe(400);
    await s.runNext(ana, a.id, (x) => x.state === 'approval');
    expect((await s.project(ana, a.id)).stages[0].provider).toBe('gemini');
  });

  it('desconectar durante uma tarefa: a etapa em andamento termina e é guardada, a conexão não volta e a próxima pede reconexão', async () => {
    const s = await startStudio({ chatgpt: true });
    const ana = await s.login('ana');
    await s.connectChatGPT(ana, 'ana');
    let release!: () => void;
    s.fake.responses = () => new Promise((resolve) => {
      release = () => resolve(sse([{ type: 'response.output_text.delta', delta: 'Concluída' }, { type: 'response.completed' }]));
    });
    const p = await s.createProject(ana, 'Projeto — briefing de teste');
    expect((await s.request('/public/projects/' + p.id + '/next', { cookie: ana, body: {} })).status).toBe(202);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const off = await s.request('/public/provider', { cookie: ana, body: { disconnect: true, provider: 'chatgpt' } });
    expect(off.json().providers[0].state).toBe('available');
    await vi.waitFor(() => expect(s.fake.revoked).toContain('renovacao-ana'));
    release();
    await vi.waitFor(async () => expect((await s.project(ana, p.id)).state).toBe('approval'));
    expect((await s.stateOf(ana, 'chatgpt')).state).toBe('available');
    await s.request('/public/projects/' + p.id + '/approve', { cookie: ana, body: { decision: 'Seguir' } });
    expect((await s.request('/public/projects/' + p.id + '/next', { cookie: ana, body: {} })).json().error).toContain('a IA não está conectada');
  });

  it('reinício: com o cofre, a conexão continua (cifrada e presa à conta); sem o cofre, a escolha fica e pede reconexão', async () => {
    const key = Buffer.alloc(32, 7);
    const dir = mkdtempSync(join(tmpdir(), 'kodexa-restart-'));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const first = await startStudio({ dir, credentialKey: key });
    const ana = await first.login('ana');
    const bia = await first.login('bia');
    await first.request('/public/provider', { cookie: ana, body: { provider: 'gemini', model: 'gemini-teste', key: 'gemini-chave-123' } });
    await first.close();
    const anaDir = readdirSync(dir).find((d) => readdirSync(join(dir, d)).includes('ai-credentials.enc'))!;
    expect(readFileSync(join(dir, anaDir, 'ai-credentials.enc')).toString('latin1')).not.toContain('gemini-chave-123');

    // Mesmo cofre: a conexão volta depois do reinício (o login Google é novo, as sessões ficam em memória).
    const second = await startStudio({ dir, credentialKey: key });
    const ana2 = await second.login('ana');
    expect((await second.stateOf(ana2, 'gemini')).state).toBe('connected');
    // O arquivo de uma conta copiado para a pasta de outra não abre (amarrado ao usuário).
    const bia2 = await second.login('bia');
    const biaDir = createHash('sha256').update('google:bia').digest('hex');
    mkdirSync(join(dir, biaDir), { recursive: true });
    copyFileSync(join(dir, anaDir, 'ai-credentials.enc'), join(dir, biaDir, 'ai-credentials.enc'));
    await second.close();
    const third = await startStudio({ dir, credentialKey: key });
    const bia3 = await third.login('bia');
    expect((await third.stateOf(bia3, 'gemini')).state).toBe('available');
    await third.close();
    void bia; void bia2;

    // Sem a chave do cofre: credenciais não são lidas; a escolha (padrão Gemini) continua e pede reconexão.
    const fourth = await startStudio({ dir });
    const ana4 = await fourth.login('ana');
    const info = await fourth.provider(ana4);
    expect(info.persistent).toBe(false);
    expect(info.defaultProvider).toBe('gemini');
    expect(info.providers.find((p: { provider: string }) => p.provider === 'gemini').state).toBe('available');
  });
});
