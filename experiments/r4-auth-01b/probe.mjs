import { sdk } from './sdk.mjs';
import { runCase } from './cases.mjs';
import { probe as previousProbe } from '../r4-auth-01/storage-cases.mjs';
globalThis.fetch = () => { throw new Error('External network forbidden'); };
const [which, name] = process.argv.slice(2), selected = sdk(which);
const watchdog = setTimeout(() => { throw new Error(`Unfinished ${which}/${name}`); }, 15000);
try {
  const result = name.startsWith('legacy:')
    ? await previousProbe(selected.createClient, selected.version, name.slice(7))
    : await runCase(selected.createClient, which, selected.version, name);
  console.log('RESULT ' + JSON.stringify(result));
} finally { clearTimeout(watchdog); }
