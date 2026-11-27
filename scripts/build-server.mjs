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

await build({
  entryPoints: ['client/src/public-office.ts'],
  outfile: 'dist/server/public-office.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  minify: true,
});

const info = writeBuildInfo('dist/build.json');
console.log(`  dist/build.json  ${info.commit === 'unknown' ? 'unknown' : info.commit.slice(0, 12)}${info.dirty ? ' (dirty)' : ''}`);

