import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sdk } from './sdk.mjs';
import { probeNames } from './storage-cases.mjs';
import { expectedCrash, verifyProbe } from './expectations.mjs';
import { generationChecks, unsafeControls } from './generation-cases.mjs';
import { modelEngine } from '../r4-sec-11/storage.mjs';
import { assert, equal } from './fixtures.mjs';
globalThis.fetch = () => { throw new Error('External network forbidden'); };
const records = [];
for (const which of ['baseline', 'candidate']) {
  const { createClient, version, graph, authSourceSha256 } = sdk(which);
  console.log('VERSIONS ' + JSON.stringify({ which, version, graph, authSourceSha256 }));
  for (const name of probeNames) {
    const processResult = spawnSync(process.execPath, ['--unhandled-rejections=strict', fileURLToPath(new URL('./probe.mjs', import.meta.url)), which, name],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert(!processResult.error, `Child failed/hung ${which} ${name}: ${processResult.error}`);
    const crash = expectedCrash(version, name);
    equal(processResult.status, crash ? 1 : 0, `Unexpected child exit ${which} ${name}: ${processResult.stderr}`);
    const line = processResult.stdout.split('\n').find(line => line.startsWith('RESULT '));
    assert(line, `Missing complete result ${which} ${name}`);
    const result = JSON.parse(line.slice(7)); verifyProbe(result);
    if (crash) assert(processResult.stderr.includes(`INJECTED_${name}`), 'Expected failure marker missing');
    else if (!['auto-set'].includes(name)) equal(processResult.stderr, '', 'Unexpected warning/error');
    const record = { which, name, exit: processResult.status, result, stdout: processResult.stdout, stderr: processResult.stderr };
    records.push(record);
    console.log(`${crash || result?.waiter === 'pending' ? 'REPRODUCED FAILURE' : 'OBSERVED'} ${version}: ${name}`);
  }
  equal(await generationChecks(createClient, version, async () => modelEngine()), 16);
  equal(await unsafeControls(createClient, version), 2);
}
await mkdir(new URL('../../tmp/', import.meta.url), { recursive: true });
await writeFile(new URL(`../../tmp/r4-auth-01-node-${process.pid}.json`, import.meta.url), JSON.stringify(records, null, 2));
console.log(`VERIFIED: ${records.length} storage/lifecycle observations; 32 generation checks; 4 unsafe shared-slot controls.`);
console.log('COMPATIBILITY NO-GO: initialization rejection and stranded terminal-refresh waiters remain. Exit 2 is the failed compatibility gate, not a harness success claim.');
process.exitCode = 2;
