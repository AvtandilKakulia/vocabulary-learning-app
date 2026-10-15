// Optional native-browser regression, no production access or new dependencies.
// node scripts/verify-practice-tabs.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe"
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const executable = process.argv[process.argv.indexOf('--browser') + 1];
if (!process.argv.includes('--browser') || !executable) throw new Error('Pass --browser with a Chrome/Chromium executable path.');
const require = createRequire(resolve('package.json'));
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }));
await mkdir(resolve('tmp'), { recursive: true });
const folder = await mkdtemp(resolve('tmp/practice-tabs-'));
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React, { StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { flushSync } from 'react-dom';
  import FreeMode from './src/components/FreeMode';
  const options = new URLSearchParams(location.search);
  if (options.has('unsupported')) Object.defineProperty(navigator, 'locks', {value: undefined});
  if (options.has('no-channel')) window.BroadcastChannel = undefined;
  window.account = options.get('account') || 'user-a';
  window.words = ['a','b','c','d'].map((id,i) => ({id, user_id: window.account,
    english_word: id, georgian_definitions: ['meaning ' + id], description: '', part_of_speech: 'noun',
    is_irregular_verb: false, past_simple: null, past_participle: null,
    created_at: '2026-01-0'+(i+1)+'T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z'}));
  window.fetch = () => { throw new Error('Network forbidden in Practice fixture'); };
  window.inserts = []; window.holdSave = false;
  window.snapshot = () => JSON.parse(localStorage.getItem('vocab_practice_session_state_v2:'+window.account));
  window.seed = (extra = {}) => localStorage.setItem('vocab_practice_session_state_v2:'+window.account, JSON.stringify({
    userId: window.account, queueIds: ['a','b','c','d'], direction:'en-to-geo', orderMode:'db-order', allowReguess:true,
    totalAttempts:0, correctCount:0, mistakes:[], attemptedWordIds:[], unresolvedWordIds:[], hasChecked:false, completed:false, ...extra}));
  const root = createRoot(document.getElementById('root'));
  window.mount = () => flushSync(() => root.render(<StrictMode><FreeMode /></StrictMode>));
  window.leave = () => flushSync(() => root.render(<div>Words</div>));
  if (!options.has('idle')) window.mount();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated-boundaries', setup(b) {
    b.onResolve({ filter: /(?:^|\/)supabase$/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
    b.onResolve({ filter: /contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'auth'
      ? 'export const useAuth = () => ({user: {id: window.account}});'
      : `export const supabase = {from(table) {
        if (!['words','test_history'].includes(table)) throw new Error('Unexpected table');
        let id; return {select(){return this}, eq(key,value){if(key==='id')id=value;return this}, order(){return this},
          insert(data){
            window.inserts.push(data);
            const key = 'fixture-history:'+data.id;
            const duplicate = localStorage.getItem(key) !== null;
            if (!duplicate) localStorage.setItem(key, JSON.stringify(data));
            const result = {error: duplicate ? {code:'23505'} : null};
            // The mocked server commits before a withheld response: closing the
            // page models a lost response without any real database connection.
            if (window.holdSave) return new Promise(resolve => {window.finishSave = () => resolve(result)});
            return Promise.resolve(result);
          },
          then(resolve){return Promise.resolve({data:table==='words'?window.words:[JSON.parse(localStorage.getItem('fixture-history:'+id))],error:null}).then(resolve)}
        };
      }};` }));
  } }] });
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
  else if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); }
  else {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; style-src 'unsafe-inline'");
    res.end('<!doctype html><meta charset="utf-8"><style>svg{width:20px;height:20px}input,button{margin:4px;padding:8px}input{display:block}</style><div id="root"></div><script src="/fixture.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--disable-background-networking',
  '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--window-size=1280,1400', `--user-data-dir=${folder}`, 'about:blank'],
{ windowsHide: true, stdio: 'ignore' });
const sockets = [];
const runtimeErrors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 200; i++) { const result = await fn(); if (result) return result; await delay(25); }
  throw new Error('Timed out waiting for native browser state');
}
async function connect(url) {
  const socket = new WebSocket(url); sockets.push(socket);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') runtimeErrors.push(msg.params.exceptionDetails);
    if (!msg.id) return;
    const entry = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(JSON.stringify(msg.error))); else entry.resolve(msg.result);
  };
  socket.onclose = () => { for (const item of pending.values()) item.reject(new Error('Page closed')); pending.clear(); };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const request = ++id; pending.set(request, { resolve, reject }); socket.send(JSON.stringify({ id: request, method, params }));
  });
  await call('Runtime.enable');
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { call, evaluate };
}
let manager;
try {
  const port = await until(async () => { try { return Number((await readFile(join(folder, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { return null; } });
  const initial = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  manager = await connect(initial.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  async function page(query = '') {
    const { targetId } = await manager.call('Target.createTarget', { url: origin + query });
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const result = await connect(list.find(tab => tab.id === targetId).webSocketDebuggerUrl);
    await until(() => result.evaluate('typeof window.mount === "function"'));
    return { ...result, targetId };
  }
  const text = tab => tab.evaluate('document.body.textContent');
  const state = tab => tab.evaluate('window.snapshot()');
  const ready = tab => until(() => tab.evaluate('document.querySelectorAll("input").length > 0'));
  const passive = tab => until(async () => (await text(tab)).includes('Continue in this tab'));
  const click = (tab, name) => tab.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`);
  async function answer(tab, value) {
    await ready(tab);
    await tab.evaluate('document.querySelector("input").focus()');
    await tab.call('Input.insertText', { text: value });
    await click(tab, 'Check Answer');
    await until(async () => (await state(tab)).hasChecked);
  }
  async function takeover(tab) {
    await passive(tab); await click(tab, 'Continue in this tab');
    assert.match(await text(tab), /Unchecked answer text/);
    await click(tab, 'Continue here');
  }
  const close = tab => manager.call('Target.closeTarget', { targetId: tab.targetId });
  console.log('Browser:', (await manager.call('Browser.getVersion')).product);
  let checks = 0;

  const a = await page('?idle'); await a.evaluate('localStorage.clear(); window.seed(); window.mount()'); await ready(a);
  await a.evaluate('document.querySelector("input").focus()'); await a.call('Input.insertText', { text: 'unfinished' });
  const b = await page(); await passive(b);
  assert.equal(await a.evaluate('document.querySelector("input").value'), 'unfinished');
  assert.equal(await b.evaluate('document.querySelectorAll("input").length'), 0); checks++;
  await b.call('Page.bringToFront'); await a.call('Page.bringToFront');
  assert.equal(await a.evaluate('document.querySelector("input").value'), 'unfinished'); checks++;
  await a.evaluate(`window.staleCheck = document.querySelector('button') && (() => {
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Check Answer');
    return button[Object.keys(button).find(k=>k.startsWith('__reactProps$'))].onClick;
  })()`);
  await click(a, 'Check Answer'); await click(a, 'Next Word'); await click(a, 'Random');
  const before = await state(a);
  await takeover(b); await ready(b); await passive(a);
  assert.deepEqual(await state(b), before);
  await a.evaluate('window.staleCheck()'); assert.deepEqual(await state(b), before); checks++;
  await close(b); await takeover(a); await ready(a); assert.deepEqual(await state(a), before); checks++;
  await a.evaluate("history.replaceState(null, '', '/')");
  await a.call('Page.reload'); await until(() => a.evaluate('typeof window.mount === "function"')); await ready(a);
  assert.deepEqual(await state(a), before); checks++;
  await close(a);

  // Independent module registries: B's insert must wait for A's real Web Lock.
  const c = await page('?idle');
  await c.evaluate("window.seed({queueIds:['a'],attemptedWordIds:['b','c','d'],allowReguess:false}); window.mount()");
  await answer(c, 'meaning a'); await click(c, 'Finish Practice');
  await until(async () => (await text(c)).includes('Practice Summary'));
  await c.evaluate('window.holdSave = true'); await click(c, 'Close & Save');
  await until(() => c.evaluate('window.inserts.length === 1'));
  const result = (await state(c)).completedResult;
  const d = await page(); await takeover(d);
  await until(async () => (await text(d)).includes('Retry Save'));
  assert.deepEqual((await state(d)).completedResult, result);
  await click(d, 'Retry Save'); await delay(100);
  assert.equal(await d.evaluate('window.inserts.length'), 0);
  await c.evaluate('window.finishSave()');
  await until(async () => (await text(d)).includes('Result saved to History'));
  assert.deepEqual(await d.evaluate('window.inserts[0]'), result);
  assert.equal(await state(d), null); checks++;
  await close(c); await close(d);

  // Crash/closure after the mocked server committed but before its response.
  const e = await page('?idle');
  await e.evaluate("window.seed({queueIds:['a'],attemptedWordIds:['b','c','d'],allowReguess:false}); window.mount()");
  await answer(e, 'meaning a'); await click(e, 'Finish Practice');
  await until(async () => (await text(e)).includes('Practice Summary'));
  await e.evaluate('window.holdSave = true'); await click(e, 'Close & Save');
  await until(() => e.evaluate('window.inserts.length === 1'));
  const interrupted = (await state(e)).completedResult;
  await close(e);
  const f = await page(); await until(async () => (await text(f)).includes('Retry Save'));
  await click(f, 'Retry Save'); await until(async () => (await text(f)).includes('Result saved to History'));
  assert.deepEqual(await f.evaluate('window.inserts[0]'), interrupted); checks++;
  await close(f);

  const unsupported = await page('?unsupported');
  await until(async () => (await text(unsupported)).includes('Web Locks'));
  assert.equal(await unsupported.evaluate('document.querySelectorAll("input,button").length'), 0); checks++;
  await close(unsupported);
  const g = await page('?no-channel'); await ready(g);
  const h = await page('?no-channel'); await takeover(h);
  assert.equal(await h.evaluate('document.querySelectorAll("input").length'), 0);
  await close(g); await ready(h); checks++;
  await close(h);
  assert.deepEqual(runtimeErrors, []);
  console.log(`${checks} native two-page checks passed. Real Web Locks/BroadcastChannel/localStorage; Auth/Supabase mocked.`);
  console.log('Isolated profile:', folder);
} finally {
  await manager?.call('Browser.close').catch(() => {});
  sockets.forEach(socket => socket.close()); browser.kill(); server.closeAllConnections(); server.close();
}
