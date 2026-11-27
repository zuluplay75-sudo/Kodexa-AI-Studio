import { isAbsolute, resolve } from 'node:path';
import { createPublicStudio } from './app';
import { chatgptConfig } from './chatgpt';
import { vaultKey } from './vault';

const { KODEXA_PUBLIC_ORIGIN, KODEXA_PUBLIC_DATA_DIR, KODEXA_GOOGLE_CLIENT_ID, KODEXA_GOOGLE_CLIENT_SECRET } = process.env;
if (!KODEXA_PUBLIC_ORIGIN || !KODEXA_PUBLIC_DATA_DIR || !KODEXA_GOOGLE_CLIENT_ID || !KODEXA_GOOGLE_CLIENT_SECRET) {
  throw new Error('Configure KODEXA_PUBLIC_ORIGIN, KODEXA_PUBLIC_DATA_DIR, KODEXA_GOOGLE_CLIENT_ID e KODEXA_GOOGLE_CLIENT_SECRET.');
}

if (!isAbsolute(KODEXA_PUBLIC_DATA_DIR)) throw new Error('Informe um caminho absoluto para o estúdio público.');
const ownerHost = process.env.KODEXA_TUNNEL_HOST?.trim().toLowerCase() || 'kodexa.ia.br';
if (new URL(KODEXA_PUBLIC_ORIGIN).hostname === ownerHost) {
  throw new Error('Use um hostname próprio para o estúdio público, separado do painel do proprietário.');
}

const server = createPublicStudio({
  origin: KODEXA_PUBLIC_ORIGIN,
  dir: resolve(KODEXA_PUBLIC_DATA_DIR),
  clientId: KODEXA_GOOGLE_CLIENT_ID,
  clientSecret: KODEXA_GOOGLE_CLIENT_SECRET,
  // Cofre das credenciais de IA dos clientes (openssl rand -base64 32); sem ele, as conexões ficam só em memória.
  credentialKey: vaultKey(process.env.KODEXA_CREDENTIALS_KEY),
  // ChatGPT do cliente: só com a liberação da OpenAI (KODEXA_CHATGPT_CLIENT_ID e KODEXA_CHATGPT_MODEL).
  chatgpt: chatgptConfig(process.env, KODEXA_PUBLIC_ORIGIN),
  // Link do Kodexa Conector na Microsoft Store (só https da Microsoft), quando publicado.
  connectorStoreUrl: /^https:\/\/(apps\.microsoft\.com|www\.microsoft\.com)\//.test(process.env.KODEXA_CONECTOR_STORE_URL ?? '') ? process.env.KODEXA_CONECTOR_STORE_URL : undefined,
});
const hosted = process.env.RENDER === 'true';
server.listen(hosted ? Number(process.env.PORT || 10000) : 4750, hosted ? '0.0.0.0' : '127.0.0.1');
