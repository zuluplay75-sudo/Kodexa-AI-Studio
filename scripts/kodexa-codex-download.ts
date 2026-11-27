// Instala o Codex oficial da OpenAI para o Kodexa Conector, sem Node nem npm no computador do cliente.
//
// De onde vem: o mesmo pacote que `npm install -g @openai/codex` instalaria. A OpenAI publica no registro do npm um
// pacote nativo por sistema (`@openai/codex@<versão>-win32-x64`, `-darwin-arm64`, ...), listado em
// optionalDependencies do `@openai/codex`. O registro publica a assinatura de integridade (sha512) de cada pacote.
//
// Como: 1) lê a versão atual; 2) baixa o .tgz do pacote da plataforma para um arquivo temporário; 3) confere o sha512
// com o do registro ANTES de extrair qualquer coisa; 4) extrai só `package/vendor/<alvo>/` (executável, rg e recursos
// de sandbox, que precisam ficar juntos) para ~/.kodexa/codex/<versão>/, recusando caminhos que saiam dessa pasta;
// 5) grava ~/.kodexa/codex/atual.json com o caminho do executável. Sem shell e sem dependências (roda dentro do .exe).
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export const REGISTRY = 'https://registry.npmjs.org';

/** Pacote e alvo de cada sistema (os mesmos do launcher oficial, @openai/codex/bin/codex.js). */
export const TARGETS: Record<string, { pkg: string; triple: string; exe: string }> = {
  'win32-x64': { pkg: '@openai/codex-win32-x64', triple: 'x86_64-pc-windows-msvc', exe: 'codex.exe' },
  'win32-arm64': { pkg: '@openai/codex-win32-arm64', triple: 'aarch64-pc-windows-msvc', exe: 'codex.exe' },
  'darwin-x64': { pkg: '@openai/codex-darwin-x64', triple: 'x86_64-apple-darwin', exe: 'codex' },
  'darwin-arm64': { pkg: '@openai/codex-darwin-arm64', triple: 'aarch64-apple-darwin', exe: 'codex' },
  'linux-x64': { pkg: '@openai/codex-linux-x64', triple: 'x86_64-unknown-linux-musl', exe: 'codex' },
  'linux-arm64': { pkg: '@openai/codex-linux-arm64', triple: 'aarch64-unknown-linux-musl', exe: 'codex' },
};

export function codexHome(home = homedir()): string {
  return join(home, '.kodexa', 'codex');
}

/** O Codex que o Kodexa instalou antes, se ainda estiver lá. */
export function installedCodex(home = homedir()): string | undefined {
  try {
    const current = JSON.parse(readFileSync(join(codexHome(home), 'atual.json'), 'utf8')) as { exe?: unknown };
    return typeof current.exe === 'string' && existsSync(current.exe) ? current.exe : undefined;
  } catch {
    return undefined;
  }
}

/** Onde baixar: versão, endereço do pacote no registro e a integridade publicada. */
export async function resolveCodexPackage(platformKey: string, fetcher: typeof fetch = fetch, registry = REGISTRY): Promise<{ version: string; tarball: string; integrity: string; size?: number }> {
  const target = TARGETS[platformKey];
  if (!target) throw new Error('O Codex não tem versão para este sistema (' + platformKey + ').');
  const latest = (await (await fetcher(registry + '/@openai/codex/latest', { redirect: 'error', signal: AbortSignal.timeout(20_000) })).json()) as { version?: unknown; optionalDependencies?: Record<string, unknown> };
  const spec = latest.optionalDependencies?.[target.pkg];
  // Ex.: "npm:@openai/codex@0.172.0-win32-x64"
  const m = typeof spec === 'string' ? /^npm:@openai\/codex@([0-9A-Za-z.+-]{1,80})$/.exec(spec) : null;
  if (!m) throw new Error('O registro do npm não informou o pacote do Codex para este sistema.');
  const meta = (await (await fetcher(registry + '/@openai/codex/' + encodeURIComponent(m[1]), { redirect: 'error', signal: AbortSignal.timeout(20_000) })).json()) as { dist?: { tarball?: unknown; integrity?: unknown; unpackedSize?: unknown } };
  const tarball = meta.dist?.tarball;
  const integrity = meta.dist?.integrity;
  if (typeof tarball !== 'string' || !tarball.startsWith(registry + '/@openai/codex/-/') || typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+=*$/.test(integrity)) {
    throw new Error('Metadados do Codex inválidos no registro do npm.');
  }
  return { version: m[1], tarball, integrity, size: typeof meta.dist?.unpackedSize === 'number' ? meta.dist.unpackedSize : undefined };
}

/** Destino de um arquivo extraído (ou undefined para pular). */
export type TarSink = { write: (chunk: Buffer) => void; end: () => void } | undefined;

/** Lê o .tar (já descompactado), arquivo por arquivo; suporta nomes longos (pax e GNU). Diretórios e links são pulados. */
export async function readTar(stream: AsyncIterable<Buffer>, onFile: (name: string, mode: number, size: number) => TarSink): Promise<void> {
  let buf: Buffer = Buffer.alloc(0);
  let pending: { remaining: number; padding: number; sink?: TarSink; meta?: 'pax' | 'gnu'; metaBuf: Buffer[] } | undefined;
  let nextName: string | undefined;
  const octal = (b: Buffer) => parseInt(b.toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
  const str = (b: Buffer) => b.toString('utf8').replace(/\0.*$/s, '');
  for await (const chunk of stream) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (pending) {
        if (pending.remaining > 0) {
          if (!buf.length) break;
          const take = Math.min(pending.remaining, buf.length);
          const part = buf.subarray(0, take);
          if (pending.meta) pending.metaBuf.push(Buffer.from(part));
          else pending.sink?.write(part);
          buf = buf.subarray(take);
          pending.remaining -= take;
          if (pending.remaining > 0) break;
        }
        if (buf.length < pending.padding) break;
        buf = buf.subarray(pending.padding);
        if (pending.meta === 'pax') nextName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(Buffer.concat(pending.metaBuf).toString('utf8'))?.[1] ?? nextName;
        else if (pending.meta === 'gnu') nextName = str(Buffer.concat(pending.metaBuf));
        else pending.sink?.end();
        pending = undefined;
      }
      if (buf.length < 512) break;
      const header = buf.subarray(0, 512);
      buf = buf.subarray(512);
      if (header.every((b) => b === 0)) continue; // fim do arquivo (blocos zerados)
      const size = octal(header.subarray(124, 136));
      const type = String.fromCharCode(header[156] || 48);
      const padding = (512 - (size % 512)) % 512;
      if (type === 'x' || type === 'L') {
        pending = { remaining: size, padding, meta: type === 'x' ? 'pax' : 'gnu', metaBuf: [] };
        continue;
      }
      const prefix = str(header.subarray(345, 500));
      const name = nextName ?? (prefix ? prefix + '/' : '') + str(header.subarray(0, 100));
      nextName = undefined;
      const sink = type === '0' || type === '7' ? onFile(name, octal(header.subarray(100, 108)), size) : undefined;
      pending = { remaining: size, padding, sink, metaBuf: [] };
    }
  }
  if (pending) throw new Error('Pacote do Codex incompleto.');
}

/** Instala (ou reaproveita) o Codex oficial em ~/.kodexa/codex/<versão>. Devolve o caminho do executável. */
export async function installCodex(opts: { platformKey?: string; home?: string; fetcher?: typeof fetch; registry?: string; log?: (line: string) => void } = {}): Promise<string> {
  const platformKey = opts.platformKey ?? process.platform + '-' + process.arch;
  const target = TARGETS[platformKey];
  if (!target) throw new Error('O Codex não tem versão para este sistema (' + platformKey + ').');
  const fetcher = opts.fetcher ?? fetch;
  const pkg = await resolveCodexPackage(platformKey, fetcher, opts.registry);
  const root = codexHome(opts.home);
  const dest = join(root, pkg.version);
  const exe = join(dest, 'bin', target.exe);
  if (!existsSync(exe)) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const tmp = join(tmpdir(), 'kodexa-codex-' + process.pid + '-' + Date.now() + '.tgz');
    try {
      opts.log?.('Baixando o Codex ' + pkg.version + ' oficial da OpenAI (registro do npm)' + (pkg.size ? ', ' + Math.round(pkg.size / 1e6) + ' MB instalado' : '') + '…');
      const response = await fetcher(pkg.tarball, { redirect: 'error', signal: AbortSignal.timeout(30 * 60_000) });
      if (!response.ok || !response.body) throw new Error('Download do Codex falhou (HTTP ' + response.status + ').');
      const hash = createHash('sha512');
      const out = createWriteStream(tmp, { mode: 0o600 });
      await pipeline(Readable.fromWeb(response.body as never), async function* (source) { for await (const c of source) { hash.update(c as Buffer); yield c; } }, out);
      // Integridade ANTES de extrair: o sha512 do arquivo baixado tem de ser o publicado pelo registro.
      if ('sha512-' + hash.digest('base64') !== pkg.integrity) throw new Error('O arquivo do Codex baixado não confere com a assinatura do registro do npm. Nada foi instalado.');
      opts.log?.('Assinatura conferida. Extraindo…');
      const staging = dest + '.parcial';
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
      const base = resolve(staging);
      const wanted = 'package/vendor/' + target.triple + '/';
      await readTar(createReadStream(tmp).pipe(createGunzip()) as AsyncIterable<Buffer>, (name, mode) => {
        if (!name.startsWith(wanted)) return undefined;
        const file = resolve(base, name.slice(wanted.length));
        if (!file.startsWith(base + sep)) throw new Error('Caminho inválido no pacote do Codex: ' + name);
        mkdirSync(dirname(file), { recursive: true });
        const fd = openSync(file, 'w', mode & 0o777 || 0o644);
        return { write: (c) => { writeSync(fd, c); }, end: () => { closeSync(fd); if (process.platform !== 'win32' && mode & 0o111) chmodSync(file, mode & 0o777); } };
      });
      if (!existsSync(join(staging, 'bin', target.exe))) throw new Error('O pacote do Codex não trouxe o executável esperado.');
      rmSync(dest, { recursive: true, force: true });
      renameSync(staging, dest);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  writeFileSync(join(root, 'atual.json'), JSON.stringify({ version: pkg.version, exe }), { mode: 0o600 });
  opts.log?.('Codex ' + pkg.version + ' instalado em ' + dest + '.');
  return exe;
}
