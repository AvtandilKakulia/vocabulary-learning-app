// Writes only the explicitly supplied disposable upstream checkout and ignored tmp bundles.
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export const hash = value => createHash('sha256').update(value).digest('hex');
export function apply(source, patch) {
  const hunks = patch.replaceAll('\r\n', '\n').split(/^@@ .* @@.*\n/m).slice(1);
  if (!hunks.length) throw Error('No hunks');
  for (const hunk of hunks) {
    const lines = hunk.replace(/\n$/, '').split('\n').map(line => line === '' ? ' ' : line);
    if (lines.some(line => !/^[ +\-]/.test(line))) throw Error('Invalid hunk');
    const before = lines.filter(line => !line.startsWith('+')).map(line => line.slice(1)).join('\n');
    const after = lines.filter(line => !line.startsWith('-')).map(line => line.slice(1)).join('\n');
    if (source.split(before).length !== 2) throw Error('Non-exact hunk');
    source = source.replace(before, after);
  }
  return source;
}
const checkout = process.argv[2], state = process.argv[3] ?? 'proposal';
if (!checkout) throw Error('Usage: node experiments/r4-auth-01c/prepare.mjs <disposable-upstream-checkout> [base|pr2742|initialSupplement|terminal|proposal|propagation] [--bundle]');
const provenance = JSON.parse(await readFile(resolve(here, 'provenance.json')));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
if (revision !== '51816da3805daf2aed7393870e34d7e3374edb69') throw Error('Wrong upstream revision');
const path = 'packages/core/auth-js/src/GoTrueClient.ts';
const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'packages/core/auth-js/src'], { cwd: checkout, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
if (changed.some(file => file !== path)) throw Error('Unexpected upstream source modification');
const base = execFileSync('git', ['show', `HEAD:${path}`], { cwd: checkout, encoding: 'utf8' }).replaceAll('\r\n', '\n');
if (hash(base) !== provenance.hashes.base) throw Error('Wrong base source');
const patch = async file => (await readFile(resolve(here, file), 'utf8')).replaceAll('\r\n', '\n');
const pr2742 = apply(base, await patch('../r4-auth-01b/upstream-2742.patch'));
const terminal = apply(base, await patch('terminal-refresh.patch'));
const initialSupplement = apply(pr2742, await patch('initial-supplement.patch'));
const proposal = apply(initialSupplement, await patch('terminal-refresh.patch'));
const previous = await patch('../r4-auth-01b/storage-settlement.patch');
const propagation = apply(proposal, previous.slice(0, previous.lastIndexOf('@@ -5119')));
const sources = { base, pr2742, initialSupplement, terminal, proposal, propagation };
if (!sources[state]) throw Error('Unknown state');
if (state !== 'propagation' && hash(sources[state]) !== provenance.hashes[state]) throw Error('Source checksum mismatch');
await writeFile(resolve(checkout, path), sources[state]);
for (const name of ['terminalStorage', 'initialStorage']) {
  await cp(resolve(here, `GoTrueClient.${name}.test.ts.txt`), resolve(checkout, `packages/core/auth-js/test/GoTrueClient.${name}.test.ts`));
}
if (process.argv.includes('--bundle')) {
  const req = createRequire(resolve('package.json'));
  const { build } = req(req.resolve('esbuild', { paths: [req.resolve('vite')] }));
  const official = resolve('tmp/r4-auth-01b-official/node_modules');
  const pkg = JSON.parse(await readFile(resolve(official, '@supabase/supabase-js/package.json')));
  if (pkg.version !== '2.118.0') throw Error('Wrong official dependency graph');
  const copy = resolve(`tmp/r4-auth-01c-build/node_modules/${state}`);
  await mkdir(copy, { recursive: true });
  await cp(resolve(checkout, 'packages/core/auth-js/src'), resolve(copy, 'src'), { recursive: true });
  for (const platform of ['node', 'browser']) await build({
    entryPoints: [resolve(official, '@supabase/supabase-js', pkg.module)], bundle: true, platform,
    format: platform === 'node' ? 'cjs' : 'esm', target: 'es2022',
    outfile: resolve(`tmp/r4-auth-01c-build/${state}.${platform === 'node' ? 'cjs' : 'mjs'}`), nodePaths: [official],
    plugins: [{ name: 'exact-source', setup(b) { b.onResolve({ filter: /^@supabase\/auth-js$/ }, () => ({ path: resolve(copy, 'src/index.ts') })); } }],
  });
  const bundles = {};
  for (const suffix of ['cjs', 'mjs']) bundles[suffix] = hash(await readFile(resolve(`tmp/r4-auth-01c-build/${state}.${suffix}`)));
  await writeFile(resolve(`tmp/r4-auth-01c-build/${state}.json`), JSON.stringify({ revision, source: hash(sources[state]), bundles }, null, 2));
}
console.log(JSON.stringify({ revision, state, sourceSha256: hash(sources[state]) }));
