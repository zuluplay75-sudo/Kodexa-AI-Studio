// Empacota as entradas do proprietário e do estúdio público em dist/server e grava dist/build.json.
import { build } from 'esbuild';
import { writeBuildInfo } from './build-info.mjs';

await build({
  entryPoints: { index: 'server/index.ts', 'public-studio': 'server/public-studio/start.ts' },
  outdir: 'dist/server',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});

const info = writeBuildInfo('dist/build.json');
console.log(`  dist/build.json  ${info.commit === 'unknown' ? 'unknown' : info.commit.slice(0, 12)}${info.dirty ? ' (dirty)' : ''}`);
