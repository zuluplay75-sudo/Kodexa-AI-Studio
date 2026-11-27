// Kodexa Conector: roda no computador do cliente e faz o Codex (ou o Claude Code) dele executar as tarefas que a
// pessoa pede no Kodexa, pelo celular ou pelo navegador. É o mesmo desenho do auxiliar do Habblaud original
// (scripts/codex-bridge.ts): sempre de saída, pergunta ao servidor se há trabalho, roda a ferramenta oficial aqui,
// com a conta e o plano do cliente, e confirma o resultado. Nenhuma chave de API, nenhuma senha sai deste computador.
//
//   Kodexa Conector.exe (ou node kodexa-conector.mjs)  primeira vez: abre o navegador em "Autorizar este computador"
//   node kodexa-conector.mjs --codigo ABCD-EFGH        alternativa: pareia com o código de Configurar estúdio
//   depois, sem opções, usa o pareamento salvo
//   opções: --servidor https://studio.kodexa.ia.br, --nome "Meu notebook", --com-claude, --autorizar, --esquecer,
//           --versao
//
// Segurança:
// - O token do pareamento fica em ~/.kodexa/conector.json (só para o seu usuário); --esquecer apaga.
// - As tarefas são de planejamento (texto). Rodam numa pasta vazia só do Kodexa (~/.kodexa/trabalho), com o Codex em
//   `--sandbox read-only --ephemeral` e o Claude Code em `-p --permission-mode dontAsk` (nenhuma ferramenta é
//   aprovada): nada é editado nem executado no seu computador.
// - Sem shell (execFile), com prazo, e o pedido vai pela entrada padrão (nunca vira opção na linha de comando).
// - O Claude Code só entra com --com-claude: confira os termos de uso do seu plano Claude antes de ligar.
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findCodexBin } from '../server/messages/codex';
import { findExecutable, runnableClaudeBin } from '../server/claude-bin';
import { createOpener, type Opener } from '../server/spawn/spawn';

export const VERSION = '1.0.0';

/** Rodando como executável único (Kodexa Conector.exe, Node SEA)? Aí process.execPath é o próprio .exe, não o Node. */
function isSea(): boolean {
  try {
    // No pacote CommonJS do .exe, `require` existe no escopo do módulo; no .mjs (ESM) não existe e o resultado é false.
    return typeof require === 'function' && !!(require('node:sea') as { isSea?: () => boolean }).isSea?.();
  } catch {
    return false;
  }
}
/** O Node que roda o launcher do Codex do npm: o próprio processo, ou (no .exe) o node do PATH. */
export function nodeForLauncher(env: NodeJS.ProcessEnv = process.env, sea = isSea()): string | undefined {
  return sea ? findExecutable('node', env) : process.execPath;
}

export const DEFAULT_SERVER = 'https://studio.kodexa.ia.br';
const TASK_TIMEOUT_MS = 12 * 60_000;
const OUTPUT_MAX = 40_000;

export type Tool = 'codex' | 'claude';
export type Job = { id: string; tool: Tool; prompt: string };
export type JobResult = { ok: true; text: string } | { ok: false; error: string };
export type Runner = (job: Job) => Promise<JobResult>;

function firstLine(s: string | undefined): string {
  return (s ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? '';
}

/** Como rodar uma ferramenta: o executável e os argumentos que vêm antes dos da tarefa. */
export type Command = { file: string; args: string[] };

/**
 * Onde está o Codex. 1) KODEXA_CODEX_BIN; 2) o executável no PATH (codex.exe no Windows, codex no macOS/Linux, como
 * no original); 3) no Windows, a instalação do npm (`npm install -g @openai/codex`) deixa só um atalho `codex.cmd`,
 * que o execFile não roda sem shell: usa o launcher do pacote com o próprio Node (`node .../@openai/codex/bin/codex.js`),
 * que é o que o atalho faz e que acha o codex.exe certo para a máquina.
 */
export function findCodex(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync, node: string | undefined = nodeForLauncher(env)): Command | undefined {
  const explicit = env.KODEXA_CODEX_BIN?.trim();
  if (explicit) return exists(explicit) ? { file: explicit, args: [] } : undefined;
  const native = findCodexBin(env);
  if (native) return { file: native, args: [] };
  if (platform !== 'win32') return undefined;
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter((d) => d && isAbsolute(d));
  if (env.APPDATA) dirs.push(join(env.APPDATA, 'npm'));
  for (const dir of dirs) {
    const launcher = join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (exists(launcher) && node) return { file: node, args: [launcher] };
  }
  return undefined;
}

/** Roda um binário sem shell, com o pedido pela entrada padrão. Nunca rejeita. */
function run(bin: string, args: string[], input: string, cwd: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string; error: string }> {
  return new Promise((done) => {
    const child = execFile(bin, args, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (!err) return done({ ok: true, stdout, error: '' });
      const e = err as NodeJS.ErrnoException & { killed?: boolean };
      done({ ok: false, stdout, error: e.killed ? 'não respondeu a tempo' : firstLine(stderr) || firstLine(stdout) || 'falhou (código ' + String(e.code ?? '?') + ')' });
    });
    child.stdin?.end(input);
  });
}

/** Codex: `codex exec` só leitura, sem guardar sessão, numa pasta vazia; o texto final vem do --output-last-message. */
export function codexRunner(codex: Command | string, workRoot: string, timeoutMs = TASK_TIMEOUT_MS): Runner {
  const command = typeof codex === 'string' ? { file: codex, args: [] } : codex;
  return async (job) => {
    const dir = mkdtempSync(join(workRoot, 'codex-'));
    try {
      const out = join(dir, 'resposta.txt');
      const r = await run(command.file, [...command.args, 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--output-last-message', out, '-'], job.prompt, dir, timeoutMs);
      let text = '';
      try { text = readFileSync(out, 'utf8'); } catch { /* sem resposta */ }
      if (!r.ok) return { ok: false, error: r.error };
      return text.trim() ? { ok: true, text: text.slice(0, OUTPUT_MAX) } : { ok: false, error: 'o Codex não devolveu texto' };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** Claude Code: `claude -p`, sem aprovar ferramenta nenhuma e sem guardar a sessão. */
export function claudeRunner(bin: string, workRoot: string, timeoutMs = TASK_TIMEOUT_MS): Runner {
  return async (job) => {
    const dir = mkdtempSync(join(workRoot, 'claude-'));
    try {
      const r = await run(bin, ['-p', '--output-format', 'text', '--permission-mode', 'dontAsk', '--no-session-persistence'], job.prompt, dir, timeoutMs);
      if (!r.ok) return { ok: false, error: r.error };
      return r.stdout.trim() ? { ok: true, text: r.stdout.slice(0, OUTPUT_MAX) } : { ok: false, error: 'o Claude Code não devolveu texto' };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

type Config = { server: string; token: string };
export function configPath(home = homedir()): string {
  return join(home, '.kodexa', 'conector.json');
}
export function readConfig(home = homedir()): Config | undefined {
  try {
    const c = JSON.parse(readFileSync(configPath(home), 'utf8')) as Config;
    return typeof c.server === 'string' && typeof c.token === 'string' ? c : undefined;
  } catch {
    return undefined;
  }
}
export function writeConfig(config: Config, home = homedir()): void {
  mkdirSync(join(home, '.kodexa'), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(home), JSON.stringify(config), { mode: 0o600 });
  try { chmodSync(configPath(home), 0o600); } catch { /* Windows */ }
}

async function post(server: string, path: string, body: unknown, token?: string, fetcher: typeof fetch = fetch): Promise<{ status: number; data: any }> {
  const response = await fetcher(server + path, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(14_000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

/** Troca o código de pareamento pelo token deste computador. */
export async function pair(server: string, code: string, name: string, fetcher?: typeof fetch, tools: Partial<Record<Tool, boolean>> = {}): Promise<string> {
  const r = await post(server, '/public/connector/claim', { code, name, tools }, undefined, fetcher);
  if (r.status !== 200 || typeof r.data.token !== 'string') throw new Error(r.data.error ?? 'Pareamento recusado (HTTP ' + r.status + ').');
  return r.data.token;
}

/**
 * "Autorizar este computador": pede ao Kodexa, abre o navegador no link (a pessoa entra com Google, confere o código
 * e clica em Autorizar) e espera a aprovação. Devolve o token deste computador.
 */
export async function authorize(server: string, name: string, tools: Partial<Record<Tool, boolean>>, opts: { open?: Opener; fetcher?: typeof fetch; log?: (line: string) => void; sleep?: (ms: number) => Promise<void> } = {}): Promise<string> {
  const r = await post(server, '/public/connector/request', { name, tools }, undefined, opts.fetcher);
  if (r.status !== 200 || typeof r.data.id !== 'string' || typeof r.data.verifyUrl !== 'string' || !r.data.verifyUrl.startsWith(server + '/public/?conectar=')) {
    throw new Error(r.data.error ?? 'O Kodexa não aceitou o pedido de autorização (HTTP ' + r.status + ').');
  }
  opts.log?.('Código deste computador: ' + r.data.userCode);
  opts.log?.('Abrindo o navegador para autorizar. Se não abrir, acesse: ' + r.data.verifyUrl);
  await (opts.open ?? createOpener())(r.data.verifyUrl).catch(() => undefined);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    await sleep(Math.max(1, Number(r.data.interval) || 3) * 1000);
    const c = await post(server, '/public/connector/collect', { id: r.data.id, secret: r.data.secret }, undefined, opts.fetcher).catch(() => undefined);
    if (c?.data?.status === 'approved' && typeof c.data.token === 'string') return c.data.token;
    if (c?.data?.status === 'expired') break;
  }
  throw new Error('A autorização não foi concluída em 10 minutos. Abra o Kodexa Conector de novo.');
}

/** Uma rodada: pergunta (com espera), roda as tarefas na ordem e confirma cada uma. Devolve quantas rodou. */
export async function round(server: string, token: string, runners: Partial<Record<Tool, Runner>>, opts: { wait?: boolean; fetcher?: typeof fetch; log?: (line: string) => void } = {}): Promise<number> {
  const tools = { codex: !!runners.codex, claude: !!runners.claude };
  const r = await post(server, '/public/connector/poll', { tools, wait: opts.wait ?? true }, token, opts.fetcher);
  if (r.status === 401) throw Object.assign(new Error(r.data.error ?? 'Computador removido da conta.'), { revoked: true });
  if (r.status !== 200) throw new Error('O Kodexa respondeu HTTP ' + r.status + '.');
  const jobs = Array.isArray(r.data.jobs) ? (r.data.jobs as Job[]) : [];
  for (const job of jobs) {
    const runner = runners[job.tool];
    opts.log?.(`Tarefa recebida (${job.tool === 'codex' ? 'Codex' : 'Claude Code'})…`);
    const result: JobResult = runner ? await runner(job) : { ok: false, error: 'ferramenta não disponível neste computador' };
    await post(server, '/public/connector/ack', { id: job.id, ...result }, token, opts.fetcher);
    opts.log?.(result.ok ? 'Tarefa concluída e enviada ao Kodexa.' : 'Tarefa não concluída: ' + result.error);
  }
  return jobs.length;
}

export async function main(argv: string[]): Promise<void> {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const log = (line: string) => console.log('[kodexa] ' + line);
  if (argv.includes('--versao')) return log('Kodexa Conector ' + VERSION + (isSea() ? ' (executável único)' : ' (Node ' + process.version + ')'));
  if (argv.includes('--esquecer')) {
    rmSync(configPath(), { force: true });
    return log('Pareamento apagado deste computador. Remova-o também em Configurar estúdio.');
  }
  let config = readConfig();
  const code = arg('--codigo');

  const work = join(homedir(), '.kodexa', 'trabalho');
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const runners: Partial<Record<Tool, Runner>> = {};
  const codex = findCodex();
  if (codex) runners.codex = codexRunner(codex, work);
  const claude = argv.includes('--com-claude') ? runnableClaudeBin(process.env) : undefined;
  if (claude) runners.claude = claudeRunner(claude, work);
  log('Codex: ' + (codex ? 'encontrado (' + [codex.file, ...codex.args].join(' ') + ')' : 'não encontrado — instale com "npm install -g @openai/codex" e entre com "codex login"'));
  log('Claude Code: ' + (claude ? 'encontrado (' + claude + ')' : argv.includes('--com-claude') ? 'não encontrado' : 'desligado (use --com-claude)'));
  if (!codex && !claude) throw new Error('Nenhuma ferramenta disponível neste computador. Instale o Codex ("npm install -g @openai/codex"), entre com "codex login" e abra o conector de novo.');
  if (code || !config || argv.includes('--autorizar')) {
    const server = (arg('--servidor') ?? config?.server ?? DEFAULT_SERVER).replace(/\/+$/, '');
    if (!/^https:\/\//.test(server) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(server)) throw new Error('Use um endereço https:// para o servidor.');
    const name = arg('--nome') ?? hostname();
    const tools = { codex: !!codex, claude: !!claude };
    config = { server, token: code ? await pair(server, code, name, undefined, tools) : await authorize(server, name, tools, { log }) };
    writeConfig(config);
    log('Computador conectado à sua conta do Kodexa.');
  }
  if (!config) throw new Error('Pareamento não encontrado.');
  log('Conectado a ' + config.server + '. Deixe esta janela aberta; Ctrl+C para parar.');

  let backoff = 2_000;
  for (;;) {
    try {
      await round(config.server, config.token, runners, { log });
      backoff = 2_000;
    } catch (error) {
      if ((error as { revoked?: boolean }).revoked) throw error;
      log('Sem conexão com o Kodexa (' + (error as Error).message + '). Tentando de novo…');
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: Error) => {
    console.error('[kodexa] ' + error.message);
    process.exit(1);
  });
}
