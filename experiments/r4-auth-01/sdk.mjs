import { createRequire } from 'node:module';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const repo = fileURLToPath(new URL('../../', import.meta.url));
export function sdk(which) {
  if (!['baseline', 'candidate'].includes(which)) throw new Error('Choose baseline or candidate');
  const root = which === 'baseline' ? repo : resolve(repo, 'tmp/r4-auth-01-candidate');
  const req = createRequire(resolve(root, 'package.json'));
  const manifest = req.resolve('@supabase/supabase-js/package.json');
  const version = JSON.parse(readFileSync(manifest)).version;
  if (version !== (which === 'baseline' ? '2.83.0' : '2.112.4')) throw new Error('Wrong installed SDK');
  if (!realpathSync(manifest).startsWith(realpathSync(root) + sep)) throw new Error('Escaped installation');
  const graph = {}, visited = new Set();
  function visit(path) {
    path = realpathSync(path); if (visited.has(path)) return; visited.add(path);
    const pkg = JSON.parse(readFileSync(path)), here = createRequire(path);
    graph[pkg.name] = pkg.version;
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      let child;
      try { child = here.resolve(`${name}/package.json`); }
      catch {
        let dir = dirname(here.resolve(name));
        while (dir !== dirname(dir)) {
          const p = resolve(dir, 'package.json');
          if (existsSync(p) && JSON.parse(readFileSync(p)).name === name) { child = p; break; }
          dir = dirname(dir);
        }
      }
      if (!child) throw new Error(`Cannot resolve ${name}`);
      visit(child);
    }
  }
  visit(manifest);
  const auth = createRequire(manifest).resolve('@supabase/auth-js/package.json');
  const source = readFileSync(resolve(dirname(auth), 'src/GoTrueClient.ts'));
  return { createClient: req('@supabase/supabase-js').createClient, version, root, manifest,
    entry: req.resolve('@supabase/supabase-js'), graph: Object.fromEntries(Object.entries(graph).sort()),
    authSourceSha256: createHash('sha256').update(source).digest('hex') };
}
if (process.argv.includes('--versions')) {
  for (const which of ['baseline', 'candidate']) {
    const { version, graph, authSourceSha256 } = sdk(which);
    console.log(JSON.stringify({ which, version, graph, authSourceSha256 }));
  }
}
if (process.argv.includes('--verify-tag')) {
  const url = 'https://raw.githubusercontent.com/supabase/supabase-js/v2.112.4/packages/core/auth-js/src/GoTrueClient.ts';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Tagged source HTTP ${response.status}`);
  const sha256 = createHash('sha256').update(await response.text()).digest('hex');
  if (sha256 !== sdk('candidate').authSourceSha256) throw new Error('Installed source differs from v2.112.4');
  console.log(`VERIFIED tagged Auth source: ${sha256}`);
}
