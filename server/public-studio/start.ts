import { resolve } from 'node:path';
import { createPublicStudio } from './app';

const { KODEXA_PUBLIC_ORIGIN, KODEXA_PUBLIC_DATA_DIR, KODEXA_GOOGLE_CLIENT_ID, KODEXA_GOOGLE_CLIENT_SECRET } = process.env;
if (!KODEXA_PUBLIC_ORIGIN || !KODEXA_PUBLIC_DATA_DIR || !KODEXA_GOOGLE_CLIENT_ID || !KODEXA_GOOGLE_CLIENT_SECRET) {
  throw new Error('Configure KODEXA_PUBLIC_ORIGIN, KODEXA_PUBLIC_DATA_DIR, KODEXA_GOOGLE_CLIENT_ID e KODEXA_GOOGLE_CLIENT_SECRET.');
}

const server = createPublicStudio({
  origin: KODEXA_PUBLIC_ORIGIN,
  dir: resolve(KODEXA_PUBLIC_DATA_DIR),
  clientId: KODEXA_GOOGLE_CLIENT_ID,
  clientSecret: KODEXA_GOOGLE_CLIENT_SECRET,
});
server.listen(4750, '127.0.0.1');
