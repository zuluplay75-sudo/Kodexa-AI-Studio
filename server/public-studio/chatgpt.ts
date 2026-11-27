// ChatGPT do próprio cliente ("Sign in with ChatGPT" com uso do plano), conforme a documentação da OpenAI
// (developers.openai.com/siwc). Para um site hospedado, o uso do plano depende de liberação da OpenAI (formulário de
// interesse); até lá o painel mostra "Aguardando liberação da OpenAI" e nada aqui é chamado. Com a liberação, o
// servidor recebe KODEXA_CHATGPT_CLIENT_ID (e o segredo, se a OpenAI emitir um), e o modelo liberado para a conta em
// KODEXA_CHATGPT_MODEL.
//
// O login do Kodexa continua sendo o Google: aqui só se pede autorização para executar tarefas no plano do cliente.
// Um ID token válido sem o escopo `chatgpt.tokens.use.direct` NÃO autoriza o uso do plano (fica "sem permissão").
// Os tokens nunca vão ao navegador, a URLs nem a logs (ver vault.ts).
import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey } from 'node:crypto';

export const CHATGPT_ISSUER = 'https://auth.openai.com';
export const CHATGPT_AUTHORIZE = 'https://auth.openai.com/api/accounts/authorize';
export const CHATGPT_TOKEN = 'https://auth.openai.com/api/accounts/oauth/token';
export const CHATGPT_DISCOVERY = 'https://auth.openai.com/.well-known/openid-configuration';
export const CHATGPT_JWKS = 'https://auth.openai.com/.well-known/jwks.json';
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
export const CHATGPT_RESPONSES = 'https://api.openai.com/v1/responses';
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = ['openid', 'email', 'offline_access', 'resource.invoke', PLAN_SCOPE].join(' ');

export type ChatGPTConfig = { clientId: string; clientSecret?: string; model: string; redirectUri: string; hostId: string };

/** Configuração a partir do ambiente; sem client id ou modelo, a integração está aguardando liberação. */
export function chatgptConfig(env: NodeJS.ProcessEnv, origin: string): ChatGPTConfig | undefined {
  const clientId = env.KODEXA_CHATGPT_CLIENT_ID?.trim();
  const model = env.KODEXA_CHATGPT_MODEL?.trim();
  if (!clientId || !model || !/^[A-Za-z0-9._-]{1,200}$/.test(clientId) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(model)) return undefined;
  return {
    clientId,
    clientSecret: env.KODEXA_CHATGPT_CLIENT_SECRET?.trim() || undefined,
    model,
    redirectUri: origin + '/public/chatgpt/callback',
    hostId: 'kodexa-' + createHash('sha256').update(origin).digest('hex').slice(0, 16),
  };
}

export type PendingAuthorization = { state: string; verifier: string; nonce: string };

export function chatgptAuthorization(config: ChatGPTConfig): { url: URL; pending: PendingAuthorization } {
  const pending = { state: token(), verifier: token(), nonce: token() };
  const url = new URL(CHATGPT_AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: SCOPES,
    resource: CHATGPT_RESOURCE,
    ext_agent_host_id: config.hostId,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'),
  }).toString();
  return { url, pending };
}

function token(): string {
  return randomBytes(32).toString('base64url');
}

/** Erro conhecido do fluxo, já em português e sem conteúdo do provedor. `expired` = a autorização acabou. */
export class ChatGPTError extends Error {
  constructor(message: string, readonly kind: 'expired' | 'denied' | 'limit' | 'unavailable' | 'config' | 'failed') {
    super(message);
  }
}

type TokenResponse = { access_token?: unknown; refresh_token?: unknown; id_token?: unknown; expires_in?: unknown; scope?: unknown; error?: unknown };

async function tokenRequest(config: ChatGPTConfig, form: Record<string, string>, fetcher: typeof fetch): Promise<TokenResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const body = new URLSearchParams(form);
  // Cliente confidencial: segredo só no cabeçalho Basic (client_secret_basic). Público: client_id no corpo + PKCE.
  if (config.clientSecret) headers.Authorization = 'Basic ' + Buffer.from(encodeURIComponent(config.clientId) + ':' + encodeURIComponent(config.clientSecret)).toString('base64');
  else body.set('client_id', config.clientId);
  const response = await fetcher(CHATGPT_TOKEN, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers, body });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : '';
    if (code === 'invalid_client' || code === 'unauthorized_client') throw new ChatGPTError('Configuração do ChatGPT recusada pela OpenAI.', 'config');
    if (/^(invalid_grant|invalid_refresh_token|token_expired|refresh_token_expired|refresh_token_invalidated|refresh_token_reused)$/.test(code)) {
      throw new ChatGPTError('Autorização do ChatGPT expirada ou revogada. Reconecte para continuar.', 'expired');
    }
    throw new ChatGPTError('A OpenAI não concluiu a autorização. Tente novamente.', 'failed');
  }
  return data;
}

export type Grant = { access: string; refresh: string; expiresAt: number; scope: string; account?: string; planUsage: boolean };

function grantFrom(data: TokenResponse, now: number, previousRefresh?: string): Grant {
  if (typeof data.access_token !== 'string' || !data.access_token) throw new ChatGPTError('Resposta de autorização inválida.', 'failed');
  const refresh = typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : previousRefresh;
  if (!refresh) throw new ChatGPTError('A OpenAI não concedeu acesso contínuo (offline_access). Reconecte e aceite todas as permissões.', 'denied');
  const seconds = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
  const scope = typeof data.scope === 'string' ? data.scope : '';
  return { access: data.access_token, refresh, expiresAt: now + seconds * 1000, scope, planUsage: scope.split(/\s+/).includes(PLAN_SCOPE) };
}

/** Confere o ID token (assinatura RS256 pelas chaves publicadas, emissor, audiência, nonce, validade); devolve o e-mail verificado. */
export async function verifyIdToken(idToken: string, config: ChatGPTConfig, nonce: string, now: number, fetcher: typeof fetch): Promise<{ sub: string; email?: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new ChatGPTError('Identidade do ChatGPT inválida.', 'failed');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string; kid?: string };
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
  if (header.alg !== 'RS256') throw new ChatGPTError('Identidade do ChatGPT inválida.', 'failed');
  const jwks = (await (await fetcher(CHATGPT_JWKS, { redirect: 'error', signal: AbortSignal.timeout(10_000) })).json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const jwk = jwks.keys?.find((k) => k.kid === header.kid);
  if (!jwk) throw new ChatGPTError('Identidade do ChatGPT inválida.', 'failed');
  const ok = verifySignature('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  const aud = claims.aud;
  const audOk = aud === config.clientId || (Array.isArray(aud) && aud.includes(config.clientId));
  if (!ok || claims.iss !== CHATGPT_ISSUER || !audOk || claims.nonce !== nonce || typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000 || typeof claims.sub !== 'string') {
    throw new ChatGPTError('Identidade do ChatGPT inválida.', 'failed');
  }
  const email = typeof claims.email === 'string' && claims.email && claims.email_verified === true ? claims.email : undefined;
  return { sub: claims.sub, email };
}

/** Troca o código do retorno pela autorização (com o verificador PKCE da transação). */
export async function exchangeCode(config: ChatGPTConfig, code: string, pending: PendingAuthorization, now: number, fetcher: typeof fetch): Promise<Grant> {
  const data = await tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: pending.verifier }, fetcher);
  const grant = grantFrom(data, now);
  if (typeof data.id_token === 'string') grant.account = (await verifyIdToken(data.id_token, config, pending.nonce, now, fetcher)).email;
  return grant;
}

/** Renova o access token (o refresh token é trocado a cada renovação: guarde sempre o último). */
export async function refreshGrant(config: ChatGPTConfig, refresh: string, now: number, fetcher: typeof fetch): Promise<Grant> {
  const data = await tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refresh, resource: CHATGPT_RESOURCE }, fetcher);
  return grantFrom(data, now, refresh);
}

/** Revoga o refresh token na OpenAI (endpoint da descoberta). Falha de rede não impede desconectar aqui. */
export async function revokeGrant(config: ChatGPTConfig, refresh: string, fetcher: typeof fetch): Promise<boolean> {
  try {
    const discovery = (await (await fetcher(CHATGPT_DISCOVERY, { redirect: 'error', signal: AbortSignal.timeout(10_000) })).json()) as { revocation_endpoint?: unknown };
    if (typeof discovery.revocation_endpoint !== 'string' || !discovery.revocation_endpoint.startsWith('https://auth.openai.com/')) return false;
    const response = await fetcher(discovery.revocation_endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refresh, token_type_hint: 'refresh_token', client_id: config.clientId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const ERRORS: Record<string, [string, ChatGPTError['kind']]> = {
  subscription_sharing_user_not_eligible: ['Este plano do ChatGPT não permite usar o plano em outros apps.', 'denied'],
  subscription_sharing_usage_limit_exceeded: ['Limite de uso do plano ChatGPT atingido neste app. Confira os limites nas configurações do ChatGPT e tente mais tarde.', 'limit'],
  subscription_sharing_usage_unavailable: ['O uso do plano ChatGPT está indisponível agora. Tente novamente em instantes.', 'unavailable'],
  subscription_sharing_user_unavailable: ['O uso do plano ChatGPT está indisponível agora. Tente novamente em instantes.', 'unavailable'],
  subscription_sharing_invalid_user: ['Autorização do ChatGPT inválida. Reconecte para continuar.', 'expired'],
  chatpass_v2_scope_not_authorized: ['O ChatGPT não autorizou o uso do plano para tarefas. Reconecte e aceite o uso do plano.', 'denied'],
  chatpass_v2_invalid_authorization_context: ['O ChatGPT não autorizou o uso do plano para tarefas. Reconecte e aceite o uso do plano.', 'denied'],
  subscription_sharing_route_not_supported: ['Recurso não disponível no plano ChatGPT.', 'failed'],
  subscription_sharing_unsupported_capability: ['Recurso não disponível no plano ChatGPT.', 'failed'],
};
function knownError(code: unknown, status: number): ChatGPTError {
  const known = typeof code === 'string' ? ERRORS[code] : undefined;
  if (known) return new ChatGPTError(known[0], known[1]);
  if (status === 401) return new ChatGPTError('Autorização do ChatGPT expirada ou revogada. Reconecte para continuar.', 'expired');
  if (status === 429) return new ChatGPTError('Limite de uso do plano ChatGPT atingido. Tente mais tarde.', 'limit');
  if (status === 403) return new ChatGPTError('O ChatGPT recusou a tarefa para esta conta.', 'denied');
  if (status >= 500) return new ChatGPTError('O ChatGPT apresentou uma falha temporária. Tente novamente em instantes.', 'unavailable');
  return new ChatGPTError('Falha na solicitação ao ChatGPT.', 'failed');
}

/** Executa uma tarefa no plano do cliente: Responses API com o access token dele, `store:false` e `stream:true`. */
export async function respond(access: string, model: string, instructions: string, input: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(CHATGPT_RESPONSES, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + access },
    body: JSON.stringify({ model, instructions, input, store: false, stream: true }),
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    throw knownError(body?.error?.code, response.status);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data || data === '[DONE]') continue;
      let event: { type?: string; delta?: unknown; response?: { error?: { code?: unknown } } };
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') text += event.delta;
      else if (event.type === 'response.failed' || event.type === 'error') throw knownError(event.response?.error?.code ?? (event as { code?: unknown }).code, 0);
      else if (event.type === 'response.completed') {
        if (!text.trim()) throw new ChatGPTError('O ChatGPT não devolveu texto.', 'failed');
        void reader.cancel().catch(() => {});
        return text;
      }
    }
    if (done) break;
  }
  // Fluxo encerrado sem response.completed: resultado parcial não conta como etapa concluída.
  throw new ChatGPTError('Resposta incompleta do ChatGPT.', 'failed');
}
