import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sdk as previousSdk } from '../r4-auth-01/sdk.mjs';
export const variants = ['baseline', 'previous', 'official', 'pr2709', 'pr2742', 'patched'];
export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function sdk(which) {
  if (!variants.includes(which)) throw new Error('Unknown SDK variant');
  if (which === 'baseline' || which === 'previous') {
    const old = previousSdk(which === 'baseline' ? 'baseline' : 'candidate');
    const pkg = JSON.parse(readFileSync(old.manifest));
    return { ...old, which, browserEntry: resolve(dirname(old.manifest), pkg.module) };
  }
  const root = resolve(repo, 'tmp/r4-auth-01b-official');
  const req = createRequire(resolve(root, 'package.json'));
  const manifest = req.resolve('@supabase/supabase-js/package.json');
  if (!realpathSync(manifest).startsWith(realpathSync(root))) throw new Error('Escaped candidate installation');
  const lock = JSON.parse(readFileSync(resolve(repo, 'experiments/r4-auth-01b/official-lock.json')));
  const graph = {};
  for (const [path, expected] of Object.entries(lock.packages)) {
    if (!path) continue;
    const pkg = JSON.parse(readFileSync(resolve(root, path, 'package.json')));
    if (pkg.version !== expected.version || !expected.integrity) throw new Error('Candidate integrity/version contract mismatch');
    graph[pkg.name] = pkg.version;
  }
  const pkg = JSON.parse(readFileSync(manifest));
  if (pkg.version !== '2.118.0') throw new Error('Wrong candidate');
  const source = readFileSync(resolve(root, 'node_modules/@supabase/auth-js/src/GoTrueClient.ts'));
  const out = resolve(repo, `tmp/r4-auth-01b-build/${which}.cjs`);
  const patched = which !== 'official';
  const sourceHash = patched ? sha256(readFileSync(resolve(repo, `tmp/r4-auth-01b-build/node_modules/${which}/src/GoTrueClient.ts`))) : sha256(source);
  return { which, version: pkg.version, graph, manifest, root,
    authSourceSha256: sourceHash, createClient: patched ? req(out).createClient : req('@supabase/supabase-js').createClient,
    browserEntry: patched ? resolve(repo, `tmp/r4-auth-01b-build/${which}.mjs`) : resolve(dirname(manifest), pkg.module) };
}
if (process.argv.includes('--inventory')) {
  for (const which of variants) {
    const { version, graph, authSourceSha256 } = sdk(which);
    console.log(JSON.stringify({ which, version, graph, authSourceSha256 }));
  }
}
