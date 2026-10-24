// Prepares only ignored, experiment-owned files. Install with the printed command.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const folder = new URL('../../tmp/r4-auth-01b-official/', import.meta.url);
const lock = await readFile(new URL('./official-lock.json', import.meta.url), 'utf8');
const root = JSON.parse(lock).packages[''];
if (root.dependencies['@supabase/supabase-js'] !== '2.118.0') throw new Error('Unexpected candidate');
await mkdir(folder, { recursive: true });
await writeFile(new URL('package.json', folder), JSON.stringify({ ...root, private: true, type: 'module' }, null, 2) + '\n');
await writeFile(new URL('package-lock.json', folder), lock);
console.log('npm ci --prefix tmp/r4-auth-01b-official --ignore-scripts --no-audit --no-fund --cache tmp/r4-auth-01b-npm-cache');
