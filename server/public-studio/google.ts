import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const authorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const profileEndpoint = 'https://openidconnect.googleapis.com/v1/userinfo';

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };
export const opaqueToken = () => randomBytes(32).toString('base64url');

export function googleLogin(config: GoogleConfig) {
  const state = opaqueToken();
  const verifier = opaqueToken();
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid',
    state,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  }).toString();
  return { state, verifier, url };
}

export function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function googleSubject(
  config: GoogleConfig, code: string, verifier: string, fetcher: typeof fetch = fetch,
): Promise<string> {
  const token = await fetcher(tokenEndpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  if (!token.ok) throw new Error('Google rejeitou a autorização.');
  const result = await token.json() as { access_token?: unknown };
  if (typeof result.access_token !== 'string' || !/^[A-Za-z0-9._~+/=-]{1,4096}$/.test(result.access_token)) {
    throw new Error('Resposta de autorização inválida.');
  }
  const profile = await fetcher(profileEndpoint, {
    headers: { Authorization: 'Bearer ' + result.access_token },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!profile.ok) throw new Error('Google não confirmou a identidade.');
  const identity = await profile.json() as { sub?: unknown };
  if (typeof identity.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(identity.sub)) {
    throw new Error('Identidade Google inválida.');
  }
  return createHash('sha256').update('google:' + identity.sub).digest('hex');
}
