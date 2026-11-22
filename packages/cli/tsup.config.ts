import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  sourcemap: true,
  clean: true,
  target: 'node24',
  platform: 'node',
  banner: { js: '#!/usr/bin/env node' },
});
