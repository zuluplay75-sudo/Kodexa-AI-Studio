// Monta o Kodexa Conector como executável único (Node SEA) para o sistema em que roda:
//   node scripts/build-connector-exe.mjs      ->  dist/connector/KodexaConector.exe (Windows) ou kodexa-conector
// Passos (documentação do Node, "Single executable applications"):
//   1. esbuild: scripts/kodexa-connector-exe.ts num só arquivo CommonJS, sem dependências fora do Node;
//   2. node --experimental-sea-config: o "blob" com esse script;
//   3. cópia do próprio node (process.execPath); no Windows, sem a assinatura da Node.js (ela deixaria de valer);
//   4. postject: injeta o blob no executável.
// No Windows a remoção da assinatura usa o signtool do Windows SDK (o runner do GitHub tem); sem ele, segue com um
// aviso. A assinatura do Kodexa, se houver certificado, entra depois (ou a Microsoft Store assina o MSIX).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inject } from 'postject';

const out = 'dist/connector';
mkdirSync(out, { recursive: true });
const win = process.platform === 'win32';
const exe = join(out, win ? 'KodexaConector.exe' : 'kodexa-conector');

await build({
  entryPoints: ['scripts/kodexa-connector-exe.ts'],
  outfile: join(out, 'kodexa-conector.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  logLevel: 'warning',
});
writeFileSync(join(out, 'sea-config.json'), JSON.stringify({
  main: join(out, 'kodexa-conector.cjs'),
  output: join(out, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}));
execFileSync(process.execPath, ['--experimental-sea-config', join(out, 'sea-config.json')], { stdio: 'inherit' });
copyFileSync(process.execPath, exe);

if (win) {
  const signtool = findSigntool();
  if (signtool) execFileSync(signtool, ['remove', '/s', exe], { stdio: 'inherit' });
  else console.warn('signtool não encontrado: o executável fica com a assinatura da Node.js inválida (instale o Windows SDK).');
} else if (process.platform === 'darwin') {
  execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });
}

await inject(exe, 'NODE_SEA_BLOB', readFileSync(join(out, 'sea-prep.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });
console.log('Kodexa Conector: ' + exe);

/** O signtool do Windows SDK (o mais novo instalado), ou undefined. */
function findSigntool() {
  const root = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  if (!existsSync(root)) return undefined;
  const versions = readdirSync(root).filter((d) => /^10\./.test(d)).sort().reverse();
  for (const v of versions) {
    const candidate = join(root, v, 'x64', 'signtool.exe');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
