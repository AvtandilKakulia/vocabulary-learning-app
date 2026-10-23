// Reuse unchanged native storage, tab signals, visibility and real interval fixture.
import '../r4-auth-01/browser.mjs';
import { createClient } from '@supabase/supabase-js';
import { names, runCase } from './cases.mjs';
import { browserErrorCount, errorMarker, verify } from './expectations.mjs';
import { probe, probeNames } from '../r4-auth-01/storage-cases.mjs';
import { verifyProbe } from '../r4-auth-01/expectations.mjs';
import { generationChecks } from '../r4-auth-01/generation-cases.mjs';
import { indexedEngine } from '../r4-sec-11/storage.mjs';
import { nextTurn, equal, assert, deferred } from '../r4-auth-01/fixtures.mjs';
const priorReady = globalThis.ready;
globalThis.ready = (async()=>{
  await priorReady;
  const which = AUTH01B_VARIANT, version = AUTH01B_VERSION;
  poc.actualVersion = version; poc.which = which;
  poc.common = () => generationChecks(createClient, which === 'baseline' ? '2.83.0' : '2.112.4',
    () => indexedEngine(`r4-sec-11-auth01b-common-${crypto.randomUUID()}`), message => console.log(`${which}/${version}: ${message}`));
  poc.matrix = async()=>{
    const records=[];
    for(const name of names){
      const before=poc.errors.length;
      const result=await runCase(createClient,which,version,name);
      const expected=browserErrorCount(which,name);
      while(poc.errors.length<before+expected){poc.errorWaiter=deferred();await poc.errorWaiter.promise;}
      await nextTurn();const errors=poc.errors.slice(before);
      equal(errors.length,expected,`${which}/${name}: unexpected unhandled errors`);
      for(const error of errors)assert(error.includes(errorMarker(name)),`Unrelated error: ${error}`);
      verify(result);records.push({...result,unhandled:errors});
    }
    poc.errorWaiter=null;return records;
  };
  poc.legacy = async()=>{
    let count=0;
    for(const name of probeNames.filter(n=>!['initialize-read','terminal-read','terminal-remove'].includes(n))){
      const before=poc.errors.length,result=await probe(createClient,version,name);await nextTurn();
      equal(poc.errors.length,before);verifyProbe({...result,version:'2.112.4'});count++;
    }
    return count;
  };
  return true;
})();
