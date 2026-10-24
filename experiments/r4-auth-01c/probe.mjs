import { sdk } from './sdk.mjs';
import { profileFor } from './expectations.mjs';
import { runCase } from '../r4-auth-01b/cases.mjs';
import { probe } from '../r4-auth-01/storage-cases.mjs';
globalThis.fetch = () => { throw Error('External network forbidden'); };
const name = process.argv[2], selected = sdk();
const watchdog = setTimeout(() => { throw Error(`Unfinished ${name}`); },15000);
try {
  const result = name.startsWith('legacy:') ? await probe(selected.createClient, selected.version, name.slice(7))
    : await runCase(selected.createClient, profileFor(name), selected.version, name);
  console.log('RESULT '+JSON.stringify(result));
} finally { clearTimeout(watchdog); }
