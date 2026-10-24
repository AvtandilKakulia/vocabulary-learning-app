import '../r4-auth-01/browser.mjs';
import { createClient } from '@supabase/supabase-js';
import { names, runCase } from '../r4-auth-01b/cases.mjs';
import { profileFor, verifyProposal } from './expectations.mjs';
import { probe, probeNames } from '../r4-auth-01/storage-cases.mjs';
import { verifyProbe } from '../r4-auth-01/expectations.mjs';
import { generationChecks } from '../r4-auth-01/generation-cases.mjs';
import { indexedEngine } from '../r4-sec-11/storage.mjs';
import { nextTurn, equal } from '../r4-auth-01/fixtures.mjs';
const priorReady=globalThis.ready;
globalThis.ready=(async()=>{
  await priorReady; poc.actualVersion='2.118.0'; poc.which='proposal';
  poc.common=()=>generationChecks(createClient,'2.112.4',()=>indexedEngine(`r4-sec-11-auth01c-${crypto.randomUUID()}`),console.log);
  poc.matrix=async()=>{
    const records=[];
    for(const name of names){
      const before=poc.errors.length, result=await runCase(createClient,profileFor(name),'2.118.0',name);
      await nextTurn(); equal(poc.errors.length,before,`Unexpected unhandled error: ${name}`);
      verifyProposal(result); records.push(result);
    }
    return records;
  };
  poc.legacy=async()=>{
    let count=0;
    for(const name of probeNames.filter(n=>!['initialize-read','terminal-read','terminal-remove'].includes(n))){
      const before=poc.errors.length, result=await probe(createClient,'2.118.0',name); await nextTurn();
      equal(poc.errors.length,before); verifyProbe({...result,version:'2.112.4'}); count++;
    }
    return count;
  };
  return true;
})();
