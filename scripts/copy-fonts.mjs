// Copies the self-hosted Tajawal font files into www/fonts so the app works fully offline.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@fontsource', 'tajawal', 'files');
const dest = join(root, 'www', 'fonts');
const weights = [400, 500, 700, 800];
const subsets = ['arabic', 'latin'];

if (!existsSync(src)) {
  console.error('Tajawal font package not installed. Run `npm ci` first.');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const w of weights) {
  for (const s of subsets) {
    const name = `tajawal-${s}-${w}-normal.woff2`;
    copyFileSync(join(src, name), join(dest, name));
  }
}
console.log(`Copied ${weights.length * subsets.length} font files to www/fonts`);
