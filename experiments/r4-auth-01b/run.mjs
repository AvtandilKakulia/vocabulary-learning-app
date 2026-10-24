import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { sdk, variants } from './sdk.mjs';
import { names } from './cases.mjs';
import { crashExpected, errorMarker, verify } from './expectations.mjs';
import { probeNames } from '../r4-auth-01/storage-cases.mjs';
import { verifyProbe } from '../r4-auth-01/expectations.mjs';
import { generationChecks, unsafeControls } from '../r4-auth-01/generation-cases.mjs';
import { modelEngine } from '../r4-sec-11/storage.mjs';
import { assert, equal } from '../r4-auth-01/fixtures.mjs';
globalThis.fetch = () => { throw new Error('External network forbidden'); };
export const legacyNames = probeNames.filter(n => !['initialize-read','terminal-read','terminal-remove'].includes(n));
const records = [];
function child(which, name) {
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict','experiments/r4-auth-01b/probe.mjs',which,name],
    {encoding:'utf8',windowsHide:true,timeout:20000});
  assert(!result.error, `Child watchdog/system error: ${which}/${name}: ${result.error}`);
  const line = result.stdout.split('\n').find(l=>l.startsWith('RESULT '));
  return {...result,result:line ? JSON.parse(line.slice(7)) : null};
}
for (const which of variants) {
  const selected = sdk(which);
  console.log(`ARTIFACT ${which}: ${selected.version}`);
  for (const name of names) {
    const r = child(which,name), crash = crashExpected(which,name);
    equal(r.status,crash ? 1 : 0,`${which}/${name}: unexpected exit ${r.stderr}`);
    if (crash) {
      assert(r.stderr.includes(errorMarker(name)),'Wrong expected crash');
      assert(!r.stderr.includes('Unfinished'),'Watchdog is not a reproduction');
      if (!name.startsWith('terminal-')) {
        const initial = r.stdout.split('\n').find(l=>l.startsWith('INITIAL '));
        assert(initial,'Missing public initialization observation');
        equal(JSON.parse(initial.slice(8)).error,null);
      }
    } else {
      assert(r.result,'Missing complete result'); verify(r.result);
      if (!r.result.logs.length) equal(r.stderr,'',`${which}/${name}: unexpected stderr`);
    }
    records.push({which,name,exit:r.status,result:r.result,stdout:r.stdout,stderr:r.stderr});
  }
  // Reuse the unchanged original assertions; this argument selects their expected
  // lockless behavior profile, not the installed version (reported above/on HTTP).
  const profile = which === 'baseline' ? '2.83.0' : '2.112.4';
  equal(await generationChecks(selected.createClient, profile, async()=>modelEngine(), s=>console.log(`${which}: ${s}`)),16);
  equal(await unsafeControls(selected.createClient,profile),2);
  if (['official','patched'].includes(which)) for (const name of legacyNames) {
    const r = child(which,`legacy:${name}`); equal(r.status,0,`${which}/legacy:${name}: ${r.stderr}`);
    assert(r.result,'Missing legacy result'); verifyProbe({...r.result,version:'2.112.4'});
    if (name !== 'auto-set') equal(r.stderr,'',`${which}/legacy:${name}: unexpected stderr`);
    records.push({which,name:`legacy:${name}`,exit:r.status,result:r.result,stderr:r.stderr});
  }
}
await mkdir('tmp/r4-auth-01b', { recursive: true });
await writeFile(`tmp/r4-auth-01b/node-${process.pid}.json`,JSON.stringify(records,null,2));
console.log(`VERIFIED: ${names.length * variants.length} blocker observations; ${legacyNames.length * 2} preserved lifecycle cases; 96 generation groups; 12 unsafe controls.`);
console.log('CONDITIONAL GO: experimental patch only; official SDKs remain NO-GO. No production upgrade authorized.');
process.exitCode=2;
