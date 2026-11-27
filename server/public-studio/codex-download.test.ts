// Instalação do Codex oficial pelo conector (scripts/kodexa-codex-download.ts) com um registro FALSO: o pacote é
// montado aqui, com a mesma estrutura do pacote real da OpenAI (package/vendor/<alvo>/...).
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { installCodex, installedCodex, readTar, resolveCodexPackage } from '../../scripts/kodexa-codex-download';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'kx-codex-')); dirs.push(d); return d; };

/** Um .tar mínimo (ustar), com cabeçalho pax para nomes longos. */
function tar(files: { name: string; body: string; mode?: number; type?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, mode: number, type: string) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0, 'utf8');
    h.write(mode.toString(8).padStart(7, '0') + '\0', 100, 'ascii');
    h.write('0000000\0', 108, 'ascii');
    h.write('0000000\0', 116, 'ascii');
    h.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    h.write('00000000000\0', 136, 'ascii');
    h.write('        ', 148, 'ascii');
    h.write(type, 156, 'ascii');
    h.write('ustar\0' + '00', 257, 'ascii');
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    return h;
  };
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  for (const f of files) {
    const body = Buffer.from(f.body);
    if (f.name.length > 100) {
      const rec = ' path=' + f.name + '\n';
      let len = rec.length + 2;
      if (String(len + rec.length).length !== String(len).length) len++;
      const pax = Buffer.from(String(String(len).length + rec.length) + rec);
      blocks.push(header('PaxHeader', pax.length, 0o644, 'x'), pad(pax));
    }
    blocks.push(header(f.name, body.length, f.mode ?? 0o644, f.type ?? '0'), pad(body));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function fakeRegistry(tgz: Buffer, opts: { integrity?: string; tarball?: string } = {}) {
  const integrity = opts.integrity ?? 'sha512-' + createHash('sha512').update(tgz).digest('base64');
  const R = 'https://registry.npmjs.org';
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === R + '/@openai/codex/latest') return Response.json({ version: '9.9.9', optionalDependencies: { '@openai/codex-win32-x64': 'npm:@openai/codex@9.9.9-win32-x64' } });
    if (url === R + '/@openai/codex/9.9.9-win32-x64') return Response.json({ dist: { tarball: opts.tarball ?? R + '/@openai/codex/-/codex-9.9.9-win32-x64.tgz', integrity, unpackedSize: 1_000_000 } });
    if (url === R + '/@openai/codex/-/codex-9.9.9-win32-x64.tgz') return new Response(new Uint8Array(tgz));
    throw new Error('inesperado: ' + url);
  };
  return fetcher;
}

const triple = 'package/vendor/x86_64-pc-windows-msvc/';
const longName = triple + 'codex-resources/' + 'pasta-com-nome-bem-comprido/'.repeat(4) + 'arquivo.txt';
const good = gzipSync(tar([
  { name: 'package/package.json', body: '{}' },
  { name: triple + 'bin/codex.exe', body: 'MZ codex', mode: 0o755 },
  { name: triple + 'codex-path/rg.exe', body: 'rg' },
  { name: longName, body: 'longo' },
  { name: triple + 'link', body: '', type: '2' },
]));

describe('instalação do Codex oficial pelo conector (sem Node no computador)', () => {
  it('lê do registro a versão e o pacote da plataforma, com a integridade publicada', async () => {
    const pkg = await resolveCodexPackage('win32-x64', fakeRegistry(good));
    expect(pkg).toMatchObject({ version: '9.9.9-win32-x64', tarball: 'https://registry.npmjs.org/@openai/codex/-/codex-9.9.9-win32-x64.tgz' });
    expect(pkg.integrity).toMatch(/^sha512-/);
    await expect(resolveCodexPackage('win32-x64', fakeRegistry(good, { tarball: 'https://outro.exemplo/codex.tgz' }))).rejects.toThrow(/inválidos/);
    await expect(resolveCodexPackage('sunos-x64', fakeRegistry(good))).rejects.toThrow(/não tem versão/);
  });

  it('instala só a pasta do alvo (com nomes longos), grava atual.json e reaproveita na segunda vez', async () => {
    const home = temp();
    const exe = await installCodex({ platformKey: 'win32-x64', home, fetcher: fakeRegistry(good) });
    expect(exe).toBe(join(home, '.kodexa', 'codex', '9.9.9-win32-x64', 'bin', 'codex.exe'));
    expect(readFileSync(exe, 'utf8')).toBe('MZ codex');
    expect(readFileSync(join(home, '.kodexa', 'codex', '9.9.9-win32-x64', longName.slice(triple.length)), 'utf8')).toBe('longo');
    expect(existsSync(join(home, '.kodexa', 'codex', '9.9.9-win32-x64', 'package.json'))).toBe(false);
    expect(existsSync(join(home, '.kodexa', 'codex', '9.9.9-win32-x64', 'link'))).toBe(false);
    expect(installedCodex(home)).toBe(exe);
    let downloads = 0;
    const counting: typeof fetch = (input, init) => { if (String(input).endsWith('.tgz')) downloads++; return fakeRegistry(good)(input, init); };
    await installCodex({ platformKey: 'win32-x64', home, fetcher: counting });
    expect(downloads).toBe(0);
  });

  it('assinatura errada: não extrai nada', async () => {
    const home = temp();
    await expect(installCodex({ platformKey: 'win32-x64', home, fetcher: fakeRegistry(good, { integrity: 'sha512-' + Buffer.alloc(64).toString('base64') }) })).rejects.toThrow(/não confere com a assinatura/);
    expect(existsSync(join(home, '.kodexa', 'codex', '9.9.9-win32-x64'))).toBe(false);
    expect(installedCodex(home)).toBeUndefined();
  });

  it('pacote com caminho para fora da pasta: recusado', async () => {
    const evil = gzipSync(tar([{ name: triple + 'bin/codex.exe', body: 'x' }, { name: triple + '../../../../fora.txt', body: 'mal' }]));
    const home = temp();
    await expect(installCodex({ platformKey: 'win32-x64', home, fetcher: fakeRegistry(evil) })).rejects.toThrow(/Caminho inválido/);
    expect(existsSync(join(home, '.kodexa', 'fora.txt'))).toBe(false);
    expect(installedCodex(home)).toBeUndefined();
  });

  it('readTar entrega o conteúdo mesmo em pedaços pequenos', async () => {
    const raw = tar([{ name: 'a.txt', body: 'x'.repeat(1500) }, { name: 'b.txt', body: 'yz' }]);
    const chunks = async function* () { for (let i = 0; i < raw.length; i += 7) yield raw.subarray(i, i + 7); };
    const got: Record<string, string> = {};
    await readTar(chunks(), (name) => { const parts: Buffer[] = []; return { write: (c) => parts.push(Buffer.from(c)), end: () => { got[name] = Buffer.concat(parts).toString(); } }; });
    expect(got).toEqual({ 'a.txt': 'x'.repeat(1500), 'b.txt': 'yz' });
  });
});
