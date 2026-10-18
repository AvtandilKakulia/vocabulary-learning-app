// Isolated native Chrome regression; no credentials, external requests or dependencies.
// node scripts/verify-practice-draft.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe"
// Add --development for React StrictMode's development effect replay.
// Reproduce before the fix: --source-ref 4b939be8c6ab360e0df9e08f98e26dde84a15a8f --expect-loss
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const executable = option('--browser');
if (!executable) throw new Error('Pass --browser with a Chrome/Chromium executable.');
const sourceRef = option('--source-ref');
const expectLoss = process.argv.includes('--expect-loss');
if (expectLoss && !sourceRef) throw new Error('--expect-loss requires an explicit baseline --source-ref.');
const mode = process.argv.includes('--development') ? 'development' : 'production';
const require = createRequire(resolve('package.json'));
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }));
await mkdir(resolve('tmp'), { recursive: true });
const folder = await mkdtemp(resolve('tmp/practice-draft-'));
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, { StrictMode } from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import FreeMode from './src/components/FreeMode';
    import { findPracticeSave } from './src/lib/practiceSaves';
    window.account='user-a'; window.inserts=[];
    window.words=['user-a','user-b'].map((user_id,i)=>({id:'word-'+i,user_id,
      english_word:i?'B private word':'yield',georgian_definitions:['meaning'],description:'fixture',
      part_of_speech:'noun',is_irregular_verb:false,past_simple:null,past_participle:null,
      created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}));
    window.fetch=()=>{throw new Error('External requests forbidden')};
    window.copy=id=>localStorage.getItem('vocab_practice_session_state_v2:'+id);
    window.snapshot=()=>JSON.parse(window.copy(window.account));
    window.latestSave=()=>window.inserts[0] && findPracticeSave(window.inserts[0]);
    const root=createRoot(document.getElementById('root'));
    window.mount=()=>flushSync(()=>root.render(<StrictMode><FreeMode /></StrictMode>));
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
  banner: { js: `
    // Force the first B commit to exhaust React's host-task budget, then hold the
    // next host callback. This models an input task arriving before passive work.
    // Input, Web Locks and BroadcastChannel stay native; no React effect is mocked.
    window.armed=false;window.armEarly=false;window.paused=false;window.tasks=[];
    let offset=0;const now=performance.now.bind(performance);
    performance.now=()=>{
      if(window.armEarly && !window.armed && document.querySelector('input')) {
        window.armed=true;window.paused=true;offset+=100;
      }
      return now()+offset;
    };
    const NativeMessageChannel=window.MessageChannel;
    window.MessageChannel=class {
      constructor(){const channel=new NativeMessageChannel();this.port2=channel.port2;
        this.port1={set onmessage(fn){channel.port1.onmessage=event=>{
          const run=()=>fn(event);if(window.paused)window.tasks.push(run);else run();
        }}};
      }
    };
    window.resumeReact=()=>{window.paused=false;window.tasks.splice(0).forEach(run=>run())};
  ` },
  plugins: [{ name: 'isolated-fixtures', setup(b) {
    if (sourceRef) b.onLoad({ filter: /FreeMode\.tsx$/ }, () => ({
      contents: execFileSync('git', ['show', sourceRef + ':src/components/FreeMode.tsx'], { encoding: 'utf8' }), loader: 'tsx',
    }));
    b.onResolve({ filter: /(?:^|\/)supabase$/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
    b.onResolve({ filter: /contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'auth'
      ? 'export const useAuth=()=>({user:{id:window.account}});'
      : `export const supabase={from(table){
        if(!['words','test_history'].includes(table))throw new Error('Unexpected table');
        let userId,count,from=0,to=499;const orders=[];
        return {select(_cols,options){count=options?.count;return this},
          eq(key,value){if(key!=='user_id')throw new Error('Unexpected filter');userId=value;return this},
          order(key){orders.push(key);return this},range(start,end){from=start;to=end;return this},
          insert(result){
            if(table!=='test_history'||result.user_id!=='user-a')throw new Error('Unexpected insert');
            window.inserts.push(structuredClone(result));
            return new Promise(resolve=>{window.finishSave=fail=>resolve({error:fail?{message:'offline'}:null})});
          },
          then(resolve){
            if(table!=='words'||!userId)throw new Error('Unscoped read');
            const rows=window.words.filter(w=>w.user_id===userId).sort((a,b)=>{
              for(const key of orders)if(a[key]!==b[key])return a[key]<b[key]?-1:1;return 0;
            });
            return Promise.resolve({data:rows.slice(from,Math.min(to+1,from+500)),count:count==='exact'?rows.length:null,error:null}).then(resolve);
          }
        };
      }};` }));
  } }],
});
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
  else if (req.url === '/') {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; style-src 'unsafe-inline'");
    res.end('<!doctype html><meta charset="utf-8"><style>svg{width:20px;height:20px}input,button{margin:4px;padding:8px}input{display:block}</style><div id="root"></div><script src="/fixture.js"></script>');
  } else { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--disable-background-networking',
  '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--window-size=1280,1400', `--user-data-dir=${folder}`, 'about:blank'],
{ windowsHide: true, stdio: 'ignore' });
const sockets = [], runtimeErrors = [];
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    const result = await fn(); if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25)); // Poll a concrete browser condition.
  }
  throw new Error('Timed out waiting for browser state');
}
async function connect(url, page = true) {
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
  if (page) await call('Runtime.enable');
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
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
  manager = await connect(version.webSocketDebuggerUrl, false);
  console.log('Browser:', (await manager.call('Browser.getVersion')).product, 'React:', mode, 'Source:', sourceRef || 'working tree');
  for (const timing of ['early', 'initialized']) for (const outcome of ['success', 'failure']) {
    const { browserContextId } = await manager.call('Target.createBrowserContext');
    const { targetId } = await manager.call('Target.createTarget', { url: origin, browserContextId });
    const tab = await connect((await targets()).find(t => t.id === targetId).webSocketDebuggerUrl);
    await until(() => tab.evaluate('typeof window.mount === "function"'));
    const click = name => tab.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`);
    const value = () => tab.evaluate('document.querySelector("input").value');
    await tab.evaluate('localStorage.clear();window.mount()');
    await until(() => tab.evaluate('window.snapshot()?.queueIds.length===1'));
    await tab.evaluate('document.querySelector("input").focus()');
    await tab.call('Input.insertText', { text: 'wrong' });
    await click('Check Answer'); await until(() => tab.evaluate('window.snapshot().hasChecked'));
    await click('Finish Practice'); await until(() => tab.evaluate('document.body.textContent.includes("Close & Save")'));
    await click('Close & Save'); await until(() => tab.evaluate('typeof window.finishSave === "function"'));
    const payload = await tab.evaluate('window.inserts[0]');
    const aCopy = await tab.evaluate('window.copy("user-a")');
    await tab.evaluate(`window.account='user-b';window.mount();window.armEarly=${timing === 'early'}`);
    try {
      if (timing === 'early') await until(() => tab.evaluate('window.armed && window.tasks.length>0'));
      else await until(() => tab.evaluate('window.snapshot()?.queueIds.length===1'));
    } catch (error) {
      console.error('B readiness:', await tab.evaluate('({text:document.body.textContent,armed:window.armed,paused:window.paused,tasks:window.tasks.length,snapshot:window.snapshot()})'));
      throw error;
    }
    await tab.evaluate('document.querySelector("input").focus()');
    await tab.call('Input.insertText', { text: 'B input' });
    const afterInput = await value();
    assert.equal(afterInput, 'B input');
    await tab.evaluate('window.resumeReact()');
    await until(() => tab.evaluate('window.snapshot()?.queueIds.length===1 && window.tasks.length===0'));
    const beforeSave = await value();
    const expected = expectLoss && timing === 'early' ? '' : 'B input';
    assert.equal(beforeSave, expected, 'B initialization must not discard an accepted draft');
    assert.equal(await tab.evaluate('window.latestSave().status'), 'saving');
    assert.equal(await tab.evaluate('window.copy("user-a")'), aCopy);
    const bCopy = await tab.evaluate('window.copy("user-b")');
    assert.deepEqual(JSON.parse(bCopy), { userId: 'user-b', queueIds: ['word-1'], direction: 'en-to-geo', orderMode: 'random',
      allowReguess: false, correctCount: 0, totalAttempts: 0, mistakes: [], attemptedWordIds: [], unresolvedWordIds: [], hasChecked: false, completed: false });
    await tab.evaluate(`window.finishSave(${outcome === 'failure'})`);
    await until(() => tab.evaluate('window.latestSave().status !== "saving"'));
    const afterSave = await value();
    assert.equal(afterSave, expected);
    assert.equal(await tab.evaluate('window.copy("user-b")'), bCopy);
    assert.equal(await tab.evaluate('window.copy("user-a")'), outcome === 'success' ? null : aCopy);
    assert.deepEqual(await tab.evaluate('window.inserts'), [payload]);
    assert.equal(await tab.evaluate('/Result saved to History|Failed to save result|Practice Summary/.test(document.body.textContent)'), false);
    console.log(JSON.stringify({ timing, outcome, afterInput, beforeSave, afterSave, resultId: payload.id }));
    await manager.call('Target.closeTarget', { targetId });
    await manager.call('Target.disposeBrowserContext', { browserContextId });
  }
  assert.deepEqual(runtimeErrors, []);
  console.log('4 native checks passed; real Web Locks/BroadcastChannel/input, isolated mocked Auth/Supabase.', folder);
} finally {
  await manager?.call('Browser.close').catch(() => {});
  sockets.forEach(socket => socket.close()); browser.kill(); server.closeAllConnections(); server.close();
}
