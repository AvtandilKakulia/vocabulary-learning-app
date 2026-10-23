// Exact source-only variants: no mutation of any installed SDK, including tmp's official copy.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { repo, sha256 } from './sdk.mjs';
const req = createRequire(resolve(repo, 'package.json'));
const { build } = req(req.resolve('esbuild', { paths: [req.resolve('vite')] }));
const root = resolve(repo, 'tmp/r4-auth-01b-official');
const auth = resolve(root, 'node_modules/@supabase/auth-js');
const original = await readFile(resolve(auth, 'src/GoTrueClient.ts'), 'utf8');
const sdkManifest = JSON.parse(await readFile(resolve(root, 'node_modules/@supabase/supabase-js/package.json')));
const provenance = JSON.parse(await readFile(new URL('./provenance.json', import.meta.url)));
if (sha256(original) !== provenance.authSourceSha256) throw new Error('Wrong upstream base source');

// Exact hunk matching only, never fuzzy application to an unverified revision.
function apply(source, patch) {
  const hunks = patch.replaceAll('\r\n', '\n').split(/^@@ .* @@.*\n/m).slice(1);
  if (!hunks.length) throw new Error('No patch hunks');
  for (const hunk of hunks) {
    // Git's --suppress-blank-empty format omits the prefix on empty context lines.
    const lines = hunk.replace(/\n$/, '').split('\n').map(line => line === '' ? ' ' : line);
    if (lines.some(line => !/^[ +\-]/.test(line))) throw new Error('Unexpected patch line');
    const before = lines.filter(line => !line.startsWith('+')).map(line => line.slice(1)).join('\n');
    const after = lines.filter(line => !line.startsWith('-')).map(line => line.slice(1)).join('\n');
    if (source.split(before).length !== 2) throw new Error('Patch hunk not unique/exact');
    source = source.replace(before, after);
  }
  return source;
}
async function readPatch(name, expectedHash) {
  const patch = (await readFile(new URL(name, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  if (sha256(patch) !== expectedHash) throw new Error('Patch differs from recorded source hunks');
  return patch;
}
const hashes = {};
for (const which of ['pr2709', 'pr2742', 'patched']) {
  const upstream = which === 'pr2709' ? '2709' : '2742';
  let source = apply(original, await readPatch(`./upstream-${upstream}.patch`, provenance.prs[upstream].patchSha256));
  if (which === 'patched') source = apply(source, await readPatch('./storage-settlement.patch', provenance.localPatchSha256));
  const expectedHash = which === 'patched' ? provenance.expectedPatchedSourceSha256 : provenance.prs[upstream].sourceSha256;
  if (sha256(source) !== expectedHash) throw new Error('Reconstructed source differs from recorded revision');
  const copy = resolve(repo, `tmp/r4-auth-01b-build/node_modules/${which}`);
  await mkdir(copy, { recursive: true });
  await cp(resolve(auth, 'src'), resolve(copy, 'src'), { recursive: true });
  await writeFile(resolve(copy, 'src/GoTrueClient.ts'), source);
  hashes[which] = sha256(source);
  for (const platform of ['node', 'browser']) {
    await build({ entryPoints: [resolve(root, 'node_modules/@supabase/supabase-js', sdkManifest.module)], bundle: true,
      platform, format: platform === 'node' ? 'cjs' : 'esm', target: 'es2022',
      outfile: resolve(repo, `tmp/r4-auth-01b-build/${which}.${platform === 'node' ? 'cjs' : 'mjs'}`),
      nodePaths: [resolve(root, 'node_modules')],
      plugins: [{ name: 'isolated-auth-source', setup(b) { b.onResolve({ filter: /^@supabase\/auth-js$/ }, () => ({ path: resolve(copy, 'src/index.ts') })); } }] });
  }
}
await writeFile(resolve(repo, 'tmp/r4-auth-01b-build/hashes.json'), JSON.stringify(hashes, null, 2));
console.log('Built isolated exact source variants: ' + JSON.stringify(hashes));
