// Kodexa Conector: como no Habblaud original (scripts/codex-bridge.ts), a IA roda no computador do cliente, com o
// Codex ou o Claude Code dele, logados no plano dele. Nada de chave de API: o servidor só guarda a fila.
//
// - Pareamento: no painel, a pessoa gera um código curto (10 min, uso único). O conector troca o código por um token
//   só daquele computador (`kx1.<usuário>.<id>.<segredo>`); o servidor guarda só o hash do segredo e a pessoa pode
//   remover o computador a qualquer momento.
// - Fila: cada etapa que usa "Codex/Claude Code no seu computador" vira uma tarefa da conta. O conector pergunta
//   (sempre de saída, como o codex-bridge), pega a tarefa, roda a ferramenta e confirma o resultado.
// - Presença: o conector conta como ligado por 45 s depois da última pergunta. Desligado, a etapa nem começa.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type LocalTool = 'codex' | 'claude';
export const LOCAL_TOOLS: readonly LocalTool[] = ['codex', 'claude'];
export const PRESENCE_MS = 45_000;
export const PAIR_MS = 10 * 60_000;
export const JOB_TIMEOUT_MS = 15 * 60_000;
export const PROMPT_MAX = 60_000;
export const RESULT_MAX = 40_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type Device = { id: string; name: string; hash: string; createdAt: number };
export type DeviceView = { id: string; name: string; createdAt: number; online: boolean; tools: Record<LocalTool, boolean> };
export type ConnectorJob = { id: string; tool: LocalTool; prompt: string };

type Pending = ConnectorJob & {
  user: string;
  deviceId?: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Erro já em português, para mostrar ao cliente na etapa. */
export class ConnectorError extends Error {}

function cleanName(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'Computador';
}

function digest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export class ConnectorHub {
  private readonly codes = new Map<string, { user: string; expires: number }>();
  private readonly seen = new Map<string, { at: number; tools: Record<LocalTool, boolean> }>(); // por dispositivo
  private readonly jobs = new Map<string, Pending[]>(); // por usuário
  private readonly waiters = new Map<string, Set<() => void>>(); // pollers esperando trabalho, por usuário
  private claimFailures = { count: 0, since: 0 };
  /** Pedidos "Autorizar este computador": o conector cria, a pessoa aprova no navegador logado, o conector recolhe. */
  private readonly requests = new Map<string, { secretHash: string; name: string; tools: Record<LocalTool, boolean>; userCode: string; expires: number; user?: string; token?: string }>();
  private requestWindow = { count: 0, since: 0 };

  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {}

  private file(user: string) {
    return join(this.dir, user, 'connector-devices.json');
  }

  devices(user: string): Device[] {
    try {
      const list = JSON.parse(readFileSync(this.file(user), 'utf8')) as Device[];
      return Array.isArray(list) ? list.filter((d) => d && typeof d.id === 'string' && typeof d.hash === 'string') : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private saveDevices(user: string, list: Device[]) {
    mkdirSync(join(this.dir, user), { recursive: true, mode: 0o700 });
    writeFileSync(this.file(user) + '.tmp', JSON.stringify(list), { mode: 0o600 });
    renameSync(this.file(user) + '.tmp', this.file(user));
  }

  /** Código de pareamento para a conta (no máximo 3 ativos por conta). */
  pairCode(user: string): { code: string; expiresAt: number } {
    const now = this.now();
    for (const [code, entry] of this.codes) if (entry.expires <= now) this.codes.delete(code);
    if ([...this.codes.values()].filter((e) => e.user === user).length >= 3) throw new ConnectorError('Já há códigos de pareamento ativos. Use um deles ou aguarde 10 minutos.');
    const bytes = randomBytes(8);
    const raw = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const code = raw.slice(0, 4) + '-' + raw.slice(4);
    const expiresAt = now + PAIR_MS;
    this.codes.set(code, { user, expires: expiresAt });
    return { code, expiresAt };
  }

  /** O conector troca o código por um token deste computador. Código de uso único. */
  claim(rawCode: unknown, rawName: unknown): { token: string; user: string } {
    const now = this.now();
    if (now - this.claimFailures.since > 60_000) this.claimFailures = { count: 0, since: now };
    if (this.claimFailures.count >= 30) throw new ConnectorError('Muitas tentativas de pareamento. Aguarde um minuto.');
    const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
    const entry = this.codes.get(code);
    if (!entry || entry.expires <= now) {
      this.claimFailures.count++;
      throw new ConnectorError('Código de pareamento inválido ou vencido. Gere outro em Configurar estúdio.');
    }
    this.codes.delete(code);
    return { token: this.addDevice(entry.user, rawName), user: entry.user };
  }

  private addDevice(user: string, rawName: unknown): string {
    const name = cleanName(rawName);
    const secret = randomBytes(32).toString('base64url');
    const device: Device = { id: randomUUID(), name, hash: digest(secret), createdAt: this.now() };
    const list = this.devices(user);
    if (list.length >= 5) throw new ConnectorError('Esta conta já tem 5 computadores. Remova um em Configurar estúdio.');
    this.saveDevices(user, [...list, device]);
    return ['kx1', user, device.id, secret].join('.');
  }

  private pruneRequests() {
    const now = this.now();
    for (const [id, r] of this.requests) if (r.expires <= now) this.requests.delete(id);
  }

  /**
   * "Autorizar este computador": o conector pede (sem conta ainda) e recebe um id para o link, um segredo só dele para
   * recolher o token e um código curto que aparece nas duas telas, para a pessoa conferir que é o mesmo computador.
   */
  createRequest(rawName: unknown, rawTools: unknown): { id: string; secret: string; userCode: string; expiresAt: number } {
    this.pruneRequests();
    const now = this.now();
    if (now - this.requestWindow.since > 60_000) this.requestWindow = { count: 0, since: now };
    if (this.requests.size >= 500 || ++this.requestWindow.count > 120) throw new ConnectorError('Muitos pedidos de autorização agora. Tente de novo em um minuto.');
    const t = (rawTools ?? {}) as Record<string, unknown>;
    const id = randomBytes(24).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const raw = [...randomBytes(4)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const expiresAt = now + PAIR_MS;
    this.requests.set(id, { secretHash: digest(secret), name: cleanName(rawName), tools: { codex: t.codex === true, claude: t.claude === true }, userCode: raw, expires: expiresAt });
    return { id, secret, userCode: raw, expiresAt };
  }

  /** O que a página mostra antes de aprovar (nome do computador e o código da janela do conector). */
  describeRequest(id: unknown): { name: string; userCode: string; tools: Record<LocalTool, boolean> } | undefined {
    this.pruneRequests();
    const r = typeof id === 'string' ? this.requests.get(id) : undefined;
    return r && !r.user ? { name: r.name, userCode: r.userCode, tools: r.tools } : undefined;
  }

  /** A pessoa logada aprova: o computador entra na conta dela; o token espera o conector recolher. */
  approveRequest(user: string, id: unknown): { tools: Record<LocalTool, boolean> } {
    this.pruneRequests();
    const r = typeof id === 'string' ? this.requests.get(id) : undefined;
    if (!r || r.user) throw new ConnectorError('Pedido de autorização inválido ou vencido. Abra o Kodexa Conector de novo.');
    r.token = this.addDevice(user, r.name);
    r.user = user;
    return { tools: r.tools };
  }

  /** O conector recolhe o token (uma vez) com o segredo do pedido. */
  collect(id: unknown, secret: unknown): { status: 'pending' } | { status: 'approved'; token: string } | { status: 'expired' } {
    this.pruneRequests();
    const r = typeof id === 'string' ? this.requests.get(id) : undefined;
    if (!r || typeof secret !== 'string') return { status: 'expired' };
    const a = Buffer.from(r.secretHash, 'hex');
    const b = Buffer.from(digest(secret), 'hex');
    if (!(a.length === b.length && timingSafeEqual(a, b))) return { status: 'expired' };
    if (!r.token) return { status: 'pending' };
    this.requests.delete(id as string);
    return { status: 'approved', token: r.token };
  }

  /** Confere o token do conector; devolve a conta e o computador (ou undefined). */
  authenticate(header: string | undefined): { user: string; deviceId: string } | undefined {
    const m = /^Bearer kx1\.([a-f0-9]{64})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(header ?? '');
    if (!m) return undefined;
    const device = this.devices(m[1]).find((d) => d.id === m[2]);
    if (!device) return undefined;
    const a = Buffer.from(device.hash, 'hex');
    const b = Buffer.from(digest(m[3]), 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? { user: m[1], deviceId: m[2] } : undefined;
  }

  revoke(user: string, id: unknown): boolean {
    const list = this.devices(user);
    const next = list.filter((d) => d.id !== id);
    if (next.length === list.length) return false;
    this.saveDevices(user, next);
    this.seen.delete(String(id));
    // Tarefas que estavam com esse computador voltam para a fila.
    for (const job of this.jobs.get(user) ?? []) if (job.deviceId === id) delete job.deviceId;
    return true;
  }

  view(user: string): DeviceView[] {
    const now = this.now();
    return this.devices(user).map((d) => {
      const seen = this.seen.get(d.id);
      const online = !!seen && now - seen.at <= PRESENCE_MS;
      return { id: d.id, name: d.name, createdAt: d.createdAt, online, tools: { codex: online && !!seen?.tools.codex, claude: online && !!seen?.tools.claude } };
    });
  }

  /** Há computador pareado; ligado com a ferramenta; ligado mas sem ela (`missing`)? */
  status(user: string, tool: LocalTool): 'none' | 'offline' | 'online' | 'missing' {
    const views = this.view(user);
    if (!views.length) return 'none';
    if (views.some((v) => v.tools[tool])) return 'online';
    return views.some((v) => v.online) ? 'missing' : 'offline';
  }

  /** Põe a tarefa na fila da conta e espera o resultado do conector. */
  run(user: string, tool: LocalTool, prompt: string, timeoutMs = JOB_TIMEOUT_MS): Promise<string> {
    if (this.status(user, tool) !== 'online') {
      return Promise.reject(new ConnectorError(tool === 'codex'
        ? 'Seu computador com o Kodexa Conector está desligado ou sem o Codex. Ligue o computador e abra o conector para continuar.'
        : 'Seu computador com o Kodexa Conector está desligado ou sem o Claude Code. Ligue o computador e abra o conector para continuar.'));
    }
    if ((this.jobs.get(user)?.length ?? 0) >= 20) return Promise.reject(new ConnectorError('Muitas tarefas na fila do seu computador. Aguarde as atuais terminarem.'));
    return new Promise<string>((resolve, reject) => {
      const job: Pending = {
        id: randomUUID(), tool, prompt: prompt.slice(0, PROMPT_MAX), user, resolve, reject,
        timer: setTimeout(() => this.finish(user, job.id, new ConnectorError('Seu computador não devolveu a tarefa a tempo. Confira o conector e tente novamente.')), timeoutMs),
      };
      const list = this.jobs.get(user) ?? [];
      list.push(job);
      this.jobs.set(user, list);
      for (const wake of this.waiters.get(user) ?? []) wake();
    });
  }

  private finish(user: string, id: string, result: Error | string) {
    const list = this.jobs.get(user) ?? [];
    const job = list.find((j) => j.id === id);
    if (!job) return false;
    clearTimeout(job.timer);
    this.jobs.set(user, list.filter((j) => j !== job));
    if (typeof result === 'string') job.resolve(result);
    else job.reject(result);
    return true;
  }

  private take(user: string, deviceId: string, tools: Record<LocalTool, boolean>): ConnectorJob[] {
    const free = (this.jobs.get(user) ?? []).filter((j) => !j.deviceId && tools[j.tool]).slice(0, 2);
    for (const job of free) job.deviceId = deviceId;
    return free.map(({ id, tool, prompt }) => ({ id, tool, prompt }));
  }

  /** Pergunta do conector: marca presença e devolve trabalho; com `waitMs`, espera até chegar algo. */
  async poll(user: string, deviceId: string, rawTools: unknown, waitMs = 0, signal?: AbortSignal): Promise<ConnectorJob[]> {
    const t = (rawTools ?? {}) as Record<string, unknown>;
    const tools = { codex: t.codex === true, claude: t.claude === true };
    this.seen.set(deviceId, { at: this.now(), tools });
    const ready = this.take(user, deviceId, tools);
    if (ready.length || waitMs <= 0) return ready;
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(user) ?? new Set();
      const done = () => { set.delete(done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, waitMs);
      signal?.addEventListener('abort', done, { once: true });
      set.add(done);
      this.waiters.set(user, set);
    });
    this.seen.set(deviceId, { at: this.now(), tools });
    return signal?.aborted ? [] : this.take(user, deviceId, tools);
  }

  /** Resultado do conector. Só vale a confirmação do computador que pegou a tarefa. */
  ack(user: string, deviceId: string, raw: unknown): boolean {
    const body = (raw ?? {}) as { id?: unknown; ok?: unknown; text?: unknown; error?: unknown };
    const job = (this.jobs.get(user) ?? []).find((j) => j.id === body.id && j.deviceId === deviceId);
    if (!job) return false;
    if (body.ok === true && typeof body.text === 'string' && body.text.trim()) return this.finish(user, job.id, body.text.slice(0, RESULT_MAX));
    const reason = typeof body.error === 'string' ? body.error.replace(/[\r\n]+/g, ' ').slice(0, 300) : '';
    const name = job.tool === 'codex' ? 'O Codex' : 'O Claude Code';
    return this.finish(user, job.id, new ConnectorError(name + ' no seu computador não concluiu a tarefa' + (reason ? ': ' + reason : '.')));
  }
}
