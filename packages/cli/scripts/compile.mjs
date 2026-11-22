// Compiles single-file executables with Bun: `npm run compile [-- target…]`.
// Default targets: linux x64/arm64, macOS x64/arm64 and Windows x64. Writes dist-bin/ and SHA256SUMS.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'dist-bin');
const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64'];
const bun = process.env.BUN ?? 'bun';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const sums = [];
for (const target of targets) {
  const file = `mopux-${target}${target.startsWith('windows') ? '.exe' : ''}`;
  const result = spawnSync(
    bun,
    ['build', 'src/cli.ts', '--compile', '--minify', `--target=bun-${target}`, `--outfile=${join(out, file)}`],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) {
    console.error(`Compiling ${target} failed.`);
    process.exit(result.status ?? 1);
  }
  sums.push(
    `${createHash('sha256')
      .update(readFileSync(join(out, file)))
      .digest('hex')}  ${file}`,
  );
}

writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(sums.join('\n'));
