import { build } from 'esbuild';
import fs from 'node:fs/promises';

await fs.rm('dist', { recursive: true, force: true });
await fs.mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  jsx: 'automatic',
  jsxImportSource: 'hono/jsx',
  sourcemap: process.env.NODE_ENV === 'production' ? false : 'linked',
  logLevel: 'info',
  legalComments: 'none',
});

await fs.cp('src/public', 'dist/public', { recursive: true });
console.log('Built dist/server.js and copied public assets to dist/public.');
