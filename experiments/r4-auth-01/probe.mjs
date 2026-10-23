// One real-SDK scenario per process. No unhandledRejection handler is installed.
import { sdk } from './sdk.mjs';
import { probe } from './storage-cases.mjs';
globalThis.fetch = () => { throw new Error('External network forbidden'); };
const which = process.argv[2], name = process.argv[3];
const { createClient, version } = sdk(which);
// Failure watchdog also keeps Node alive for SDK-owned unref'ed auto-refresh timers.
const watchdog = setTimeout(() => { throw new Error('Probe did not complete: ' + name); }, 15000);
try { console.log('RESULT ' + JSON.stringify(await probe(createClient, version, name))); }
finally { clearTimeout(watchdog); }
