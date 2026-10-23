// Prepare ONLY the ignored candidate installation; run the printed npm ci next.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const folder = new URL('../../tmp/r4-auth-01-candidate/', import.meta.url);
const lock = await readFile(new URL('./candidate-lock.json', import.meta.url), 'utf8');
const root = JSON.parse(lock).packages[''];
if (root.dependencies['@supabase/supabase-js'] !== '2.112.4') throw new Error('Unexpected candidate');
await mkdir(folder, { recursive: true });
await writeFile(new URL('package.json', folder), JSON.stringify({ ...root, private: true, type: 'module' }, null, 2) + '\n');
await writeFile(new URL('package-lock.json', folder), lock);
console.log(`Prepared ${fileURLToPath(folder)}; no application dependency changed.`);
console.log('npm ci --prefix tmp/r4-auth-01-candidate --ignore-scripts --no-audit --no-fund --cache tmp/r4-auth-01-npm-cache');
