import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { hashPassword, parsePasswordHash } from '../server/remote/password';
import { codespaceLoginHost } from '../server/http/codespace-login';

const dir = join(homedir(), '.kodexa-studio');
const file = join(dir, 'owner-login.json');
type Owner = { user: string; hash: string };

async function hidden(question: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) throw new Error('Abra um terminal interativo para configurar a senha.');
  process.stdout.write(question + ': ');
  input.setRawMode(true);
  input.setEncoding('utf8');
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\u0003' || ch === '\u0004') return finish(new Error('Configuração cancelada.'));
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ' && value.length < 256) value += ch;
      }
    };
    input.on('data', onData);
  });
}

async function setup() {
  if (!process.stdin.isTTY) throw new Error('Use o terminal interativo do Codespaces.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let user = '';
  try { user = (await rl.question('Usuário do Kodexa [diretor]: ')).trim() || 'diretor'; }
  finally { rl.close(); }
  if (!/^[a-zA-Z0-9_.@-]{1,80}$/.test(user)) throw new Error('Usuário inválido.');
  const password = await hidden('Crie uma senha (mínimo 12 caracteres)');
  const confirm = await hidden('Repita a senha');
  if (password !== confirm || password.length < 12 || password.trim() !== password || password.toLowerCase() === user.toLowerCase()) throw new Error('Senha inválida ou confirmação diferente.');
  const owner: Owner = { user, hash: await hashPassword(password) };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const temp = join(dir, '.login-' + randomUUID());
  try {
    await writeFile(temp, JSON.stringify(owner) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
  console.log('Login do diretor salvo localmente. A senha não foi gravada. Reinicie o servidor após alterar a senha.');
}
async function start() {
  const host = codespaceLoginHost(process.env);
  if (!host) throw new Error('Este comando é exclusivo do GitHub Codespaces com domínio app.github.dev.');
  const owner = JSON.parse(await readFile(file, 'utf8')) as Owner;
  if (typeof owner.user !== 'string' || !/^[a-zA-Z0-9_.@-]{1,80}$/.test(owner.user) || !parsePasswordHash(owner.hash)) throw new Error('Configure o login novamente.');
  // Preserve existing data dir and integrations; change only the launch-specific settings.
  const env = { ...process.env,
    HABBLAUD_IN_DOCKER: '0', HABBLAUD_HOST: '127.0.0.1', HABBLAUD_PORT: '4747',
    HABBLAUD_CODESPACE_LOGIN: '1', HABBLAUD_REMOTE_USER: owner.user,
    HABBLAUD_REMOTE_PASSWORD_HASH: owner.hash, HABBLAUD_REMOTE_PASSWORD: '',
    HABBLAUD_REMOTE_ALLOW: 'permissions,messages,spawn', HABBLAUD_REMOTE_INSECURE_HTTP: '0',
    HABBLAUD_ALLOWED_HOSTS: host, HABBLAUD_WORLD: '0', HABBLAUD_DEMO: '0',
    HABBLAUD_DATA_DIR: process.env.KODEXA_DATA_DIR?.trim() || (process.env.HABBLAUD_DATA_DIR?.trim() && process.env.HABBLAUD_DATA_DIR.trim() !== '/data' ? process.env.HABBLAUD_DATA_DIR.trim() : join(homedir(), '.habblaud')),
    HABBLAUD_TERMINAL: '1', HABBLAUD_MENSAGENS: '1', HABBLAUD_PTY: '1',
  };
  console.log('Encaminhe somente a porta 4748 como Private, protocolo HTTP interno. Não encaminhe 4747.');
  console.log('Endereço HTTPS esperado: https://' + host);
  const child = spawn(process.execPath, ['dist/server/index.js'], { env, stdio: 'inherit' });
  child.on('error', () => { console.error('Não foi possível iniciar o servidor. Execute npm run build.'); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
}
const command = process.argv[2];
(command === 'setup' ? setup() : command === 'start' ? start() : Promise.reject(new Error('Use setup ou start.')))
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Falha na configuração.'); process.exitCode = 1; });
