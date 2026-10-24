import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { sdk } from './sdk.mjs';
import { names } from '../r4-auth-01b/cases.mjs';
import { verifyProposal } from './expectations.mjs';
import { probeNames } from '../r4-auth-01/storage-cases.mjs';
import { verifyProbe } from '../r4-auth-01/expectations.mjs';
import { generationChecks, unsafeControls } from '../r4-auth-01/generation-cases.mjs';
import { modelEngine } from '../r4-sec-11/storage.mjs';
import { assert, equal } from '../r4-auth-01/fixtures.mjs';
globalThis.fetch = () => { throw Error('External network forbidden'); };
const legacy = probeNames.filter(name=>!['initialize-read','terminal-read','terminal-remove'].includes(name));
const records=[];
for (const name of [...names,...legacy.map(name=>`legacy:${name}`)]) {
  const child=spawnSync(process.execPath,['--unhandled-rejections=strict','experiments/r4-auth-01c/probe.mjs',name],
    {encoding:'utf8',windowsHide:true,timeout:20000});
  assert(!child.error,String(child.error)); equal(child.status,0,`${name}: ${child.stderr}`);
  const line=child.stdout.split('\n').find(line=>line.startsWith('RESULT ')); assert(line,`No result: ${name}`);
  const result=JSON.parse(line.slice(7));
  if(name.startsWith('legacy:')) verifyProbe({...result,version:'2.112.4'}); else verifyProposal(result);
  if(!result.logs?.length && name!=='legacy:auto-set') equal(child.stderr,'',`Unexpected stderr ${name}`);
  records.push({name,result,stderr:child.stderr});
}
const selected=sdk();
equal(await generationChecks(selected.createClient,'2.112.4',async()=>modelEngine(),console.log),16);
equal(await unsafeControls(selected.createClient,'2.112.4'),2);
await mkdir('tmp/r4-auth-01c',{recursive:true});
await writeFile(`tmp/r4-auth-01c/node-${process.pid}.json`,JSON.stringify(records,null,2));
console.log('PASS: 21 blocker cases; 25 preserved lifecycle cases; 16 generation groups; 2 unsafe controls. Experimental source only.');
