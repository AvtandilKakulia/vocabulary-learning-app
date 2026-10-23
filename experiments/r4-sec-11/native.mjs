// Usage: node experiments/r4-sec-11/native.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe"
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const executable = process.argv[process.argv.indexOf('--browser') + 1];
if (!process.argv.includes('--browser') || !executable) throw new Error('Pass --browser with a Chromium executable path');
const require = createRequire(resolve('package.json'));
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }));
const bundle = await build({ entryPoints: ['experiments/r4-sec-11/browser.mjs'], bundle: true,
  platform: 'browser', format: 'iife', write: false });
await mkdir(resolve('tmp'), { recursive: true });
const folder = await mkdtemp(resolve('tmp/r4-sec-11-chrome-'));
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
  else if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); }
  else {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'");
    res.end('<!doctype html><meta charset="utf-8"><title>R4-SEC-11 isolated fixture</title><script src="/fixture.js"></script>');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const sockets = new Set();
let processHandle, exited, control, port;
async function connect(url) {
  const ws = new WebSocket(url); sockets.add(ws);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
  let next = 0;
  const pending = new Map(), events = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (!msg.id) { events.get(msg.method)?.splice(0).forEach(done => done(msg.params)); return; }
    const job = pending.get(msg.id); if (!job) return;
    pending.delete(msg.id); clearTimeout(job.timer);
    if (msg.error) job.fail(new Error(JSON.stringify(msg.error))); else job.done(msg.result);
  };
  ws.onclose = () => { sockets.delete(ws); for (const job of pending.values()) { clearTimeout(job.timer); job.fail(new Error('Browser closed')); } pending.clear(); };
  const call = (method, params = {}) => new Promise((done, fail) => {
    const id = ++next;
    // Failure watchdog only; scenario ordering uses explicit gates/events.
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timed out: ${method}`)); }, 30000);
    pending.set(id, { done, fail, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const once = method => new Promise(done => { if (!events.has(method)) events.set(method, []); events.get(method).push(done); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { call, evaluate, once };
}
async function launch() {
  // Exact known disposable profile path; no user profile is read or removed.
  await rm(join(folder, 'DevToolsActivePort'), { force: true });
  processHandle = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--disable-background-networking',
    '--disable-extensions', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${folder}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  exited = new Promise((done, fail) => { processHandle.once('exit', done); processHandle.once('error', fail); });
  // Bounded readiness polling for browser startup only, never race assertions.
  for (let attempt = 0; attempt < 200; attempt++) {
    try { port = Number((await readFile(join(folder, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch { /* not created yet */ }
    await new Promise(done => setTimeout(done, 25));
  }
  assert(port, 'Chrome startup failed');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  control = await connect(version.webSocketDebuggerUrl);
  console.log(`Native browser: ${version.Browser}; isolated profile ${folder}`);
}
async function page(db) {
  const { targetId } = await control.call('Target.createTarget', { url: 'about:blank' });
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab = await connect(tabs.find(t => t.id === targetId).webSocketDebuggerUrl);
  await tab.call('Page.enable'); await tab.call('Runtime.enable');
  const loaded = tab.once('Page.loadEventFired');
  await tab.call('Page.navigate', { url: `${origin}/?db=${db}` }); await loaded; await tab.evaluate('ready');
  return { ...tab, targetId };
}
async function shutdown() {
  if (!processHandle) return;
  await control?.call('Browser.close').catch(() => {}); await exited;
  for (const ws of sockets) ws.close(); processHandle = null; port = null;
}
let scenarios = 0;
const pass = text => { scenarios++; console.log(`NATIVE ${scenarios}: ${text}`); };
try {
  await launch();
  const common = await page(`r4-sec-11-common-${crypto.randomUUID()}`);
  const checks = await common.evaluate('poc.common()');
  assert.equal(checks, 24); assert.deepEqual(await common.evaluate('poc.errors'), []);
  console.log(`Native IndexedDB + real SDK: ${checks} common checks passed (controlled SDK lock scheduling).`);
  await control.call('Target.closeTarget', { targetId: common.targetId });

  for (const scenario of ['queued logout', 'in-flight logout', 'refresh success', 'refresh failure']) {
    const db = `r4-sec-11-tabs-${crypto.randomUUID()}`, a = await page(db), b = await page(db);
    await a.evaluate("poc.login('a','A')");
    // Delay our actual BroadcastChannel delivery. It may make A's rendered view
    // stale, but authoritative storage admission/data checks must still hold.
    await a.evaluate('poc.pauseHints=true; poc.hintWaiter=poc.deferred(); true');
    if (scenario === 'queued logout') {
      await a.evaluate(`(async()=>{
        poc.releaseLock=poc.deferred(); poc.lockHeld=poc.deferred();
        poc.lockJob=navigator.locks.request('lock:'+poc.entries.a.handle.namespace,async()=>{poc.lockHeld.resolve(); await poc.releaseLock.promise});
        await poc.lockHeld.promise;
        const request=navigator.locks.request.bind(navigator.locks);
        poc.requestQueued=poc.deferred();
        navigator.locks.request=(name,...args)=>{const pending=request(name,...args);if(name==='lock:'+poc.entries.a.handle.namespace)poc.requestQueued.resolve();return pending};
        poc.operation=poc.entries.a.client.auth.signOut({scope:'local'});
        await poc.requestQueued.promise; navigator.locks.request=request;
        const locks=await navigator.locks.query();
        poc.assert(locks.held.some(l=>l.name==='lock:'+poc.entries.a.handle.namespace));
        poc.assert(locks.pending.some(l=>l.name==='lock:'+poc.entries.a.handle.namespace));
      })()`);
    } else {
      const kind = scenario.startsWith('refresh') ? 'refresh' : 'logout';
      await a.evaluate(`(async()=>{poc.gate=poc.api.hold('${kind}','A');
        poc.operation=poc.entries.a.client.auth.${kind === 'refresh' ? 'refreshSession()' : "signOut({scope:'local'})"};
        await poc.gate.reached.promise})()`);
    }
    await b.evaluate("poc.login('b','B')");
    const before = await b.evaluate("poc.bytes('b')");
    await a.evaluate('poc.hintWaiter.promise');
    await a.evaluate('poc.assert(poc.queuedHints.length>0); poc.rejects(()=>poc.manager.words(poc.entries.a),/Obsolete/)');
    if (scenario.startsWith('refresh')) await a.evaluate('poc.manager.retire(poc.entries.a)');
    if (scenario === 'queued logout') await a.evaluate('poc.releaseLock.resolve(); poc.lockJob');
    else await a.evaluate(`poc.gate.response.resolve(${scenario === 'refresh success' ? "poc.json(poc.payload('A','late'))" : scenario === 'refresh failure' ? 'poc.rejectedRefresh()' : 'new Response(null,{status:204})'}); true`);
    await a.evaluate('poc.operation.then(result=>{if(result.error && result.error.status!==400)throw result.error})');
    if (!scenario.startsWith('refresh')) await a.evaluate('poc.manager.retire(poc.entries.a)');
    await a.evaluate('poc.drainHints()');
    await b.evaluate(`poc.preserve('b',${JSON.stringify(before)})`);
    assert.deepEqual(await a.evaluate('poc.errors'), []);
    pass(`two tabs, real Web Locks/BroadcastChannel: ${scenario}, exact B preserved`);
    await control.call('Target.closeTarget', { targetId: a.targetId });
    await control.call('Target.closeTarget', { targetId: b.targetId });
  }
  const db = `r4-sec-11-restart-${crypto.randomUUID()}`, a = await page(db), b = await page(db);
  const oldA = await a.evaluate("poc.login('a','A')");
  const stale = await a.evaluate('(async()=>{poc.stale=await poc.manager.begin();return poc.stale.handle})()');
  const currentB = await b.evaluate("poc.login('b','B')");
  const before = await b.evaluate("poc.bytes('b')");
  await a.evaluate("poc.rejects(()=>poc.manager.signIn(poc.stale,'A'),/Stale activation/)");
  await b.evaluate('poc.hintWaiter=poc.deferred();true');
  await a.evaluate("poc.channel.postMessage({delete:true,uid:'B'});true");
  await b.evaluate(`(async()=>{await poc.hintWaiter.promise;await poc.preserve('b',${JSON.stringify(before)})})()`);
  pass('stale activation and forged native signal cannot select/delete B');

  // Independent contexts race actual IDB transactions; any admitted write must
  // precede retirement, never recreate credentials after the retirement commit.
  await b.evaluate(`poc.oldA=${JSON.stringify(oldA)}; true`);
  await Promise.all([
    b.evaluate("poc.store.adapter(poc.oldA).setItem(poc.oldA.namespace,JSON.stringify(poc.payload('A','concurrent'))).catch(e=>{if(!/retired/i.test(e.message))throw e})"),
    a.evaluate('poc.manager.retire(poc.entries.a,{account:true})'),
  ]);
  await b.evaluate(`poc.preserve('b',${JSON.stringify(before)})`);
  await b.evaluate("(async()=>{poc.equal(await poc.store.adapter(poc.oldA).getItem(poc.oldA.namespace),null);await poc.rejects(()=>poc.store.adapter(poc.oldA).setItem(poc.oldA.namespace,JSON.stringify(poc.payload('A'))),/Retired/)})()");
  assert.equal(await a.evaluate(`(async()=>{const s=await poc.store.snapshot();return s.generations[${JSON.stringify(stale.id)}].retired})()`), true);
  pass('cross-tab write/confirmed retirement transaction race, all A candidates retired');

  const loaded = b.once('Page.loadEventFired'); await b.call('Page.reload'); await loaded; await b.evaluate('ready');
  await b.evaluate("(async()=>{poc.entries.b=await poc.manager.restore();poc.assert(poc.entries.b)})()");
  await b.evaluate(`poc.preserve('b',${JSON.stringify(before)})`);
  await b.evaluate(`poc.rejects(()=>poc.store.activate(${JSON.stringify(oldA)}),/Retired/)`);
  pass('actual page reload preserves exact B and rejects retired A activation');
  await shutdown(); // Graceful full browser process exit, not only a new manager.
  await launch();
  const restarted = await page(db);
  await restarted.evaluate("(async()=>{poc.entries.b=await poc.manager.restore();poc.assert(poc.entries.b)})()");
  await restarted.evaluate(`poc.preserve('b',${JSON.stringify(before)})`);
  assert.equal(await restarted.evaluate('poc.manager.view.id'), currentB.id);
  await restarted.evaluate(`(async()=>{const a=${JSON.stringify(oldA)};poc.equal(await poc.store.adapter(a).getItem(a.namespace),null);await poc.rejects(()=>poc.store.activate(a),/Retired/); const fresh=await poc.manager.begin();await poc.rejects(()=>poc.manager.signIn(fresh,'A'),/Retired/)})()`);
  pass('full Chrome restart, same origin/profile: B restoration and persistent A retirement');
  console.log(`PASS: ${checks} native IndexedDB common checks; ${scenarios} native multi-page/reload/restart scenarios.`);
} finally {
  await shutdown(); await new Promise(done => server.close(done));
}
