// Conexões de IA de cada cliente do estúdio público, separadas em duas partes:
//
// - Roteamento (ai-routing.json): qual IA é a padrão da conta e qual cada agente usa. Não é segredo e sobrevive a
//   reinícios e à expiração de uma autorização: o painel pede para reconectar em vez de esquecer a escolha.
// - Credenciais (ai-credentials.enc): chaves de API e tokens OAuth. Só são gravadas em disco com uma chave do servidor
//   (KODEXA_CREDENTIALS_KEY, 32 bytes), cifradas com AES-256-GCM e amarradas ao usuário (AAD): o arquivo de uma conta
//   não abre como o de outra. Sem a chave, ficam só em memória, como antes (somem ao sair ou ao reiniciar).
// Nada daqui vai para o navegador, para logs ou para o JSON dos projetos.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAGES, type StudioRole } from '../../shared/studio-project';

export const PROVIDERS = ['chatgpt', 'openai', 'anthropic', 'gemini'] as const;
export type Provider = typeof PROVIDERS[number];
export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

/** Autorização OAuth (ChatGPT): os tokens e o que foi concedido. */
export type OAuthGrant = {
  access: string;
  refresh: string;
  /** Validade do access token (ms desde a época). */
  expiresAt: number;
  scope: string;
  /** Rótulo da conta vinculada para o painel (e-mail verificado), quando o provedor informa. */
  account?: string;
};
export type Credential = {
  provider: Provider;
  model: string;
  linkedAt: number;
  key?: string;
  oauth?: OAuthGrant;
  /** A autorização parou de valer (recusada, revogada ou vencida): a escolha fica, o painel pede reconexão. */
  expired?: boolean;
  /** O provedor confirmou a identidade mas não liberou o uso para tarefas (ChatGPT sem o escopo do plano). */
  noPermission?: boolean;
};
export type Routing = { defaultProvider?: Provider; assignments: Partial<Record<StudioRole, Provider>> };

const ALG = 'aes-256-gcm';

export class ConnectionVault {
  private readonly memory = new Map<string, Map<Provider, Credential>>();
  private readonly key?: Buffer;

  constructor(private readonly dir: string, key?: Buffer) {
    if (key && key.length !== 32) throw new Error('KODEXA_CREDENTIALS_KEY precisa ter 32 bytes (base64).');
    this.key = key;
  }

  /** As credenciais sobrevivem a reinícios (há chave do servidor)? */
  get persistent(): boolean {
    return !!this.key;
  }

  private file(user: string, name: string): string {
    return join(this.dir, user, name);
  }

  private write(user: string, name: string, data: Buffer | string): void {
    mkdirSync(join(this.dir, user), { recursive: true, mode: 0o700 });
    const path = this.file(user, name);
    writeFileSync(path + '.tmp', data, { mode: 0o600 });
    renameSync(path + '.tmp', path);
  }

  routing(user: string): Routing {
    try {
      const raw = JSON.parse(readFileSync(this.file(user, 'ai-routing.json'), 'utf8')) as Routing;
      const out: Routing = { assignments: {} };
      if (isProvider(raw.defaultProvider)) out.defaultProvider = raw.defaultProvider;
      for (const [role] of STAGES) if (isProvider(raw.assignments?.[role])) out.assignments[role] = raw.assignments[role];
      return out;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { assignments: {} };
      throw error;
    }
  }

  saveRouting(user: string, routing: Routing): void {
    this.write(user, 'ai-routing.json', JSON.stringify(routing));
  }

  credentials(user: string): Map<Provider, Credential> {
    const cached = this.memory.get(user);
    if (cached) return cached;
    const loaded = new Map<Provider, Credential>();
    if (this.key) {
      try {
        const blob = readFileSync(this.file(user, 'ai-credentials.enc'));
        const decipher = createDecipheriv(ALG, this.key, blob.subarray(0, 12));
        decipher.setAAD(Buffer.from('kodexa-ai-credentials:v1:' + user));
        decipher.setAuthTag(blob.subarray(12, 28));
        const plain = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
        for (const c of JSON.parse(plain) as Credential[]) if (isProvider(c.provider)) loaded.set(c.provider, c);
      } catch (error) {
        // Sem arquivo: conta sem conexões. Arquivo que não abre (chave trocada, arquivo de outra conta, adulterado):
        // não é usado; a pessoa conecta de novo.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') loaded.clear();
      }
    }
    this.memory.set(user, loaded);
    return loaded;
  }

  private persist(user: string): void {
    if (!this.key) return;
    const list = [...(this.memory.get(user)?.values() ?? [])];
    if (!list.length) {
      rmSync(this.file(user, 'ai-credentials.enc'), { force: true });
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALG, this.key, iv);
    cipher.setAAD(Buffer.from('kodexa-ai-credentials:v1:' + user));
    const body = Buffer.concat([cipher.update(JSON.stringify(list), 'utf8'), cipher.final()]);
    this.write(user, 'ai-credentials.enc', Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  get(user: string, provider: Provider): Credential | undefined {
    return this.credentials(user).get(provider);
  }

  set(user: string, credential: Credential): void {
    this.credentials(user).set(credential.provider, credential);
    this.persist(user);
  }

  delete(user: string, provider: Provider): void {
    this.credentials(user).delete(provider);
    this.persist(user);
  }

  /** Contas com credenciais carregadas em memória. */
  loadedUsers(): string[] {
    return [...this.memory.keys()];
  }

  /** Sem chave do servidor, as credenciais vivem só enquanto a conta tem sessão aberta (comportamento anterior). */
  forgetIfVolatile(user: string): void {
    if (!this.key) this.memory.delete(user);
  }
}

/** Chave do cofre a partir de KODEXA_CREDENTIALS_KEY (base64 de 32 bytes); ausente: undefined (modo só memória). */
export function vaultKey(raw: string | undefined): Buffer | undefined {
  if (!raw?.trim()) return undefined;
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) throw new Error('KODEXA_CREDENTIALS_KEY precisa ter 32 bytes em base64 (gere com: openssl rand -base64 32).');
  return key;
}
