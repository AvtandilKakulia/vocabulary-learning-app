// Usage: node experiments/r4-auth-01b/native.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe"
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { sdk, variants } from './sdk.mjs';
import assert from 'node:assert/strict';

const executable = process.argv[process.argv.indexOf('--browser') + 1];
if (!process.argv.includes('--browser') || !executable) throw new Error('Pass --browser with a Chromium executable path');
const require = createRequire(resolve('package.json'));
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }));
const bundles = {};
for (const which of variants) {
  const selected = sdk(which);
  const entry = selected.browserEntry;
  bundles[which] = await build({ entryPoints: ['experiments/r4-auth-01b/browser.mjs'], bundle: true,
    platform: 'browser', format: 'iife', write: false, define: { AUTH01_VERSION: JSON.stringify(which === 'baseline' ? '2.83.0' : '2.112.4'), AUTH01B_VERSION: JSON.stringify(selected.version), AUTH01B_VARIANT: JSON.stringify(which) },
    plugins: [{ name: 'exact-isolated-sdk', setup(build) { build.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: entry })); } }] });
}
await mkdir(resolve('tmp'), { recursive: true });
const folder = await mkdtemp(resolve('tmp/r4-auth-01b-chrome-'));
const server = createServer((req, res) => {
  const which = new URL(req.url, 'http://127.0.0.1').searchParams.get('which') ?? 'baseline';
  if (!bundles[which]) { res.writeHead(400); res.end(); return; }
  if (req.url.startsWith('/fixture.js?')) { res.setHeader('Content-Type', 'text/javascript'); res.end(bundles[which].outputFiles[0].contents); }
  else if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); }
  else {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'");
    res.end('<!doctype html><meta charset="utf-8"><title>R4-AUTH-01B isolated fixture</title><script src="/fixture.js?which='+which+'"></script>');
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
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timed out: ${method}`)); }, 45000);
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
async function page(which, db) {
  const { targetId } = await control.call('Target.createTarget', { url: 'about:blank' });
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab = await connect(tabs.find(t => t.id === targetId).webSocketDebuggerUrl);
  await tab.call('Page.enable'); await tab.call('Runtime.enable');
  const loaded = tab.once('Page.loadEventFired');
  await tab.call('Page.navigate', { url: `${origin}/?which=${which}&db=${db}` }); await loaded; await tab.evaluate('ready');
  return { ...tab, targetId };
}
async function shutdown() {
  if (!processHandle) return;
  await control?.call('Browser.close').catch(() => {}); await exited;
  for (const ws of sockets) ws.close(); processHandle = null; port = null;
}
let scenarios = 0;
const observations = [], pass = name => { scenarios++; console.log(`NATIVE ${scenarios}: ${name}`); };
try {
  await launch();
  for (const which of variants) {
    const common = await page(which, `r4-sec-11-auth01-matrix-${crypto.randomUUID()}`);
    await common.call('Page.bringToFront');
    const matrix = await common.evaluate('poc.matrix()');
    assert.equal(matrix.length, 21); observations.push({ which, matrix });
    const beforeErrors = await common.evaluate('poc.errors.length');
    assert.equal(await common.evaluate('poc.common()'), 16);
    assert.equal(await common.evaluate('poc.controls()'), 2);
    assert.equal(await common.evaluate('poc.errors.length'), beforeErrors);
    if (['official','patched'].includes(which)) assert.equal(await common.evaluate('poc.legacy()'),25);
    console.log(`${which}: 21 blocker observations, 16 IDB generation groups, 2 unsafe controls; expected errors=${beforeErrors}`);
    await control.call('Target.closeTarget', { targetId: common.targetId });

    for (const scenario of ['queued logout', 'in-flight logout', 'refresh success', 'refresh failure']) {
      const db = `r4-sec-11-auth01-tabs-${crypto.randomUUID()}`, a = await page(which, db), b = await page(which, db);
      await a.evaluate("poc.login('a','A')");
      await a.evaluate('poc.pauseHints=true; poc.hintWaiter=poc.deferred(); true');
      if (scenario === 'queued logout') {
        await a.evaluate(`(async()=>{
          const entry=poc.entries.a, original=entry.storage.getItem.bind(entry.storage); let first=true;
          poc.readReached=poc.deferred(); poc.readRelease=poc.deferred();
          entry.storage.getItem=async key=>{if(first){first=false;poc.readReached.resolve();await poc.readRelease.promise}return original(key)};
          poc.operation=poc.observe(entry.client.auth.signOut({scope:'local'})); await poc.readReached.promise;
          const locks=await navigator.locks.query();
          poc.equal(locks.held.some(l=>l.name==='lock:'+entry.handle.namespace),poc.version==='2.83.0');
        })()`);
      } else {
        const kind = scenario.startsWith('refresh') ? 'refresh' : 'logout';
        await a.evaluate(`(async()=>{poc.gate=poc.api.hold('${kind}','A');
          poc.operation=poc.observe(poc.entries.a.client.auth.${kind === 'refresh' ? 'refreshSession()' : "signOut({scope:'local'})"});
          await poc.gate.reached.promise})()`);
      }
      await b.evaluate("poc.login('b','B')"); const before = await b.evaluate("poc.bytes('b')");
      await a.evaluate('poc.hintWaiter.promise');
      await a.evaluate('poc.assert(poc.queuedHints.length>0); poc.rejects(()=>poc.manager.words(poc.entries.a),/Obsolete/)');
      if (scenario.startsWith('refresh')) await a.evaluate('poc.manager.retire(poc.entries.a)');
      if (scenario === 'queued logout') await a.evaluate('poc.readRelease.resolve();true');
      else await a.evaluate(`poc.gate.response.resolve(${scenario === 'refresh success' ? "poc.json(poc.payload('A','late'))" : scenario === 'refresh failure' ? 'poc.rejectedRefresh()' : 'new Response(null,{status:204})'});true`);
      await a.evaluate('poc.operation.done');
      const expected = scenario === 'refresh failure' || (which !== 'baseline' && scenario === 'refresh success') ? 'returned-error' : 'success';
      assert.equal(await a.evaluate('poc.operation.state'), expected);
      if (!scenario.startsWith('refresh')) await a.evaluate('poc.manager.retire(poc.entries.a)');
      await a.evaluate('poc.drainHints()'); await b.evaluate(`poc.preserve('b',${JSON.stringify(before)})`);
      assert.deepEqual(await a.evaluate('poc.errors'), []); assert.deepEqual(await b.evaluate('poc.errors'), []);
      pass(`${which}: two tabs / BroadcastChannel / actual default SDK locks: ${scenario}`);
      await control.call('Target.closeTarget', { targetId: a.targetId }); await control.call('Target.closeTarget', { targetId: b.targetId });
    }
    const db = `r4-sec-11-auth01-restart-${crypto.randomUUID()}`, a = await page(which, db), b = await page(which, db);
    const oldA = await a.evaluate("poc.login('a','A')");
    const stale = await a.evaluate('(async()=>{poc.stale=await poc.manager.begin();return poc.stale.handle})()');
    const currentB = await b.evaluate("poc.login('b','B')"), before = await b.evaluate("poc.bytes('b')");
    await a.evaluate("poc.rejects(()=>poc.manager.signIn(poc.stale,'A'),/Stale activation/)");
    await b.evaluate('poc.hintWaiter=poc.deferred();true'); await a.evaluate("poc.channel.postMessage({delete:true,uid:'B'});true");
    await b.evaluate(`(async()=>{await poc.hintWaiter.promise;await poc.preserve('b',${JSON.stringify(before)})})()`);
    pass(`${which}: stale activation and forged native hint`);
    await b.evaluate(`poc.oldA=${JSON.stringify(oldA)};true`);
    await Promise.all([
      b.evaluate("poc.store.adapter(poc.oldA).setItem(poc.oldA.namespace,JSON.stringify(poc.payload('A','concurrent'))).catch(e=>{if(!/retired/i.test(e.message))throw e})"),
      a.evaluate('poc.manager.retire(poc.entries.a,{account:true})'),
    ]);
    await b.evaluate(`poc.preserve('b',${JSON.stringify(before)})`);
    await b.evaluate("(async()=>{poc.equal(await poc.store.adapter(poc.oldA).getItem(poc.oldA.namespace),null);await poc.rejects(()=>poc.store.adapter(poc.oldA).setItem(poc.oldA.namespace,JSON.stringify(poc.payload('A'))),/Retired/)})()");
    assert.equal(await a.evaluate(`(async()=>{const s=await poc.store.snapshot();return s.generations[${JSON.stringify(stale.id)}].retired})()`), true);
    pass(`${which}: native cross-tab transaction/retirement race`);

    // Test real Web Locks independently of the candidate's now-lockless SDK.
    await a.evaluate(`(async()=>{poc.lockHeld=poc.deferred();poc.release=poc.deferred();poc.lockJob=navigator.locks.request('auth01-app-lock',async()=>{poc.lockHeld.resolve();await poc.release.promise});await poc.lockHeld.promise})()`);
    await b.evaluate(`poc.lockEntered=false;poc.lockJob=navigator.locks.request('auth01-app-lock',()=>{poc.lockEntered=true});true`);
    const lockState = await b.evaluate('navigator.locks.query()');
    assert(lockState.held.some(l => l.name === 'auth01-app-lock')); assert(lockState.pending.some(l => l.name === 'auth01-app-lock'));
    assert.equal(await b.evaluate('poc.lockEntered'), false); await a.evaluate('poc.release.resolve();poc.lockJob'); await b.evaluate('poc.lockJob');
    assert.equal(await b.evaluate('poc.lockEntered'), true); pass(`${which}: native application Web Locks exclusivity`);
    const loaded = b.once('Page.loadEventFired'); await b.call('Page.reload'); await loaded; await b.evaluate('ready');
    await b.evaluate("(async()=>{poc.entries.b=await poc.manager.restore();poc.assert(poc.entries.b)})()");
    await b.evaluate(`poc.preserve('b',${JSON.stringify(before)})`); await b.evaluate(`poc.rejects(()=>poc.store.activate(${JSON.stringify(oldA)}),/Retired/)`);
    pass(`${which}: actual page reload`);
    await shutdown(); await launch(); const restarted = await page(which, db);
    await restarted.evaluate("(async()=>{poc.entries.b=await poc.manager.restore();poc.assert(poc.entries.b)})()");
    await restarted.evaluate(`poc.preserve('b',${JSON.stringify(before)})`); assert.equal(await restarted.evaluate('poc.manager.view.id'), currentB.id);
    await restarted.evaluate(`(async()=>{const a=${JSON.stringify(oldA)};poc.equal(await poc.store.adapter(a).getItem(a.namespace),null);await poc.rejects(()=>poc.store.activate(a),/Retired/);const fresh=await poc.manager.begin();await poc.rejects(()=>poc.manager.signIn(fresh,'A'),/Retired/)})()`);
    assert.deepEqual(await restarted.evaluate('poc.errors'), []); pass(`${which}: full graceful Chrome restart`);
    await control.call('Target.closeTarget', { targetId: restarted.targetId });
    const foreground = await page(which, `r4-sec-11-auth01-visibility-${crypto.randomUUID()}`);
    await foreground.call('Page.bringToFront'); await foreground.evaluate("poc.waitVisibility('visible')");
    await foreground.evaluate('poc.startVisibility()');
    const covering = await page(which, `r4-sec-11-auth01-cover-${crypto.randomUUID()}`);
    await covering.call('Page.bringToFront'); await foreground.evaluate("poc.waitVisibility('hidden')");
    await foreground.evaluate('poc.expireHidden()'); await foreground.call('Page.bringToFront');
    assert.equal(await foreground.evaluate('poc.finishVisibility()'), true);
    assert.deepEqual(await foreground.evaluate('poc.errors'), []);
    pass(`${which}: native hidden-to-foreground expiry recovery`);
    await control.call('Target.closeTarget', { targetId: foreground.targetId }); await control.call('Target.closeTarget', { targetId: covering.targetId });
  }
  // All six real intervals run concurrently; completion is an actual SDK event.
  const ticking = await Promise.all(variants.map(async which => {
    const tab = await page(which, `r4-sec-11-auth01-interval-${crypto.randomUUID()}`);
    await tab.evaluate('poc.startInterval()'); return { which, tab };
  }));
  for (const { which, tab } of ticking) {
    const interval = await tab.evaluate('poc.finishInterval()'); observations.push({ which, interval });
    assert.deepEqual(await tab.evaluate('poc.errors'), []); pass(`${which}: actual 30s SDK interval, ${interval.elapsedMs.toFixed(1)}ms`);
  }
  await writeFile(join(folder, 'observations.json'), JSON.stringify(observations, null, 2));
  console.log(`VERIFIED NATIVE: 126 blocker observations; 50 preserved lifecycle cases; 96 generation checks; 12 unsafe controls; ${scenarios} multi-page/lock/reload/restart/interval scenarios.`);
  console.log('CONDITIONAL GO: experimental source patch only; official SDKs remain NO-GO.');
  process.exitCode = 2;
} finally { await shutdown(); await new Promise(done => server.close(done)); }
