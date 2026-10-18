// node scripts/history-benchmark/run.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe"
// Optional: --runs 5 --sizes 100,500,1000,2000,5000 --cap 500 --latency 50 --mbps 10 --label baseline
// Latency/throughput are a fixture-server delay model, NOT measured internet speed.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { fixtures, ordered, account, otherAccount } from './fixtures.mjs';

const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const executable = option('--browser');
if (!executable) throw new Error('Pass --browser with a Chrome/Chromium executable path.');
const runs = Number(option('--runs', 5));
const sizes = option('--sizes', '100,500,1000,2000,5000').split(',').map(Number);
const cap = Number(option('--cap', 500)), latency = Number(option('--latency', 50)), mbps = Number(option('--mbps', 10));
const label = option('--label', 'baseline');
const profiling = process.argv.includes('--profile');
const screenshots = process.argv.includes('--screenshots');
// Re-measure an immutable baseline with the SAME readiness checks and fixtures.
const historyRef = option('--history-ref', null);
if (historyRef) assert.match(historyRef, /^[a-f0-9]{40}$/);
const historySource = historyRef
  ? execFileSync('git', ['show', `${historyRef}:src/components/History.tsx`], { encoding: 'utf8' }) : null;
const expectSortReads = process.argv.includes('--expect-sort-reads');
// Explicit flag keeps immutable PR #35/all-row baselines reproducible.
const pagination = !process.argv.includes('--all-rows');
const sourceHash = createHash('sha256').update((historySource ?? await readFile(resolve('src/components/History.tsx'), 'utf8')).replaceAll('\r\n', '\n')).digest('hex');
assert.match(label, /^[a-z0-9-]+$/);
assert.ok(Number.isSafeInteger(runs) && runs > 0 && runs <= 30);
assert.ok(sizes.every(n => Number.isSafeInteger(n) && n > 0 && n <= 10000));
assert.ok(Number.isSafeInteger(cap) && cap > 0 && cap <= 1000 && latency >= 0 && mbps > 0);
await mkdir(resolve('tmp'), { recursive: true });
const folder = await mkdtemp(resolve('tmp/history-perf-'));
await writeFile(join(folder, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="bg-gray-50"><main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"><div id="root"></div></main><script type="module" src="/scripts/history-benchmark/browser.jsx"></script></body></html>`);
const output = await build({ configFile: false, envDir: folder, plugins: [
  { name: 'history-audit-boundaries', enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('/lib/supabase')) return '\0audit-supabase';
      if (id.endsWith('/contexts/AuthContext')) return '\0audit-auth';
    },
    load(id) {
      if (historySource && id.replaceAll('\\', '/').endsWith('/src/components/History.tsx')) return historySource;
      if (id === '\0audit-auth') return `export const useAuth = () => ({ user: { id: '${account}' } });`;
      if (id === '\0audit-supabase') return `
        import { createClient } from '@supabase/supabase-js';
        window.auditRequests = [];
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input, location.href);
          const method = init?.method || (input instanceof Request ? input.method : 'GET');
          if (url.origin !== location.origin || url.pathname !== '/rest/v1/test_history' || method !== 'GET')
            throw new Error('Benchmark forbids external or destructive requests: '+method+' '+url.pathname);
          const options = new URLSearchParams(location.search);
          url.searchParams.set('__size', options.get('size'));
          url.searchParams.set('__cap', options.get('cap'));
          const entry = { start: performance.now(), url: url.pathname+url.search }; window.auditRequests.push(entry);
          const response = await nativeFetch(url, init);
          entry.responseHeaders = { encoding: response.headers.get('content-encoding'), length: response.headers.get('content-length') };
          const read = response.text.bind(response);
          response.text = async () => { const text = await read(); entry.bodyEnd = performance.now(); return text; };
          return response;
        };
        export const supabase = createClient(location.origin, 'synthetic-key-no-permissions', {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });`;
    },
  }, react(),
], build: { write: false, minify: true, sourcemap: true, rollupOptions: { input: join(folder, 'index.html') } } });
const files = new Map(output.output.map(file => [file.fileName, Buffer.from(file.type === 'asset' ? file.source : file.code)]));
const require = createRequire(resolve('package.json'));
const { SourceMapConsumer } = require(require.resolve('source-map-js', { paths: [require.resolve('vite')] }));
const maps = new Map([...files].filter(([name]) => name.endsWith('.js.map'))
  .map(([name, bytes]) => [name.slice(0, -4), new SourceMapConsumer(JSON.parse(bytes.toString()))]));
function profileSummary(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const totals = new Map();
  profile.samples.forEach((id, i) => {
    const frame = nodes.get(id).callFrame;
    const name = frame.url ? new URL(frame.url).pathname.slice(1) : '';
    const source = maps.get(name)?.originalPositionFor({ line: frame.lineNumber + 1, column: frame.columnNumber });
    const location = source?.source ? `${source.source}:${source.line} ${source.name || frame.functionName}` : frame.functionName || '(native/unknown)';
    totals.set(location, (totals.get(location) ?? 0) + profile.timeDeltas[i] / 1000);
  });
  return [...totals].map(([location, ms]) => ({ location, ms })).sort((a, b) => b.ms - a.ms).slice(0, 30);
}
const html = [...files.keys()].find(name => name.endsWith('index.html'));
const datasets = new Map(sizes.map(size => [size, [...fixtures(size), ...fixtures(11, otherAccount)]]));
const requests = [], violations = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'none'; object-src 'none'");
  try {
    assert.equal(req.method, 'GET', 'Read-only benchmark');
    if (url.pathname === '/rest/v1/test_history') {
      const size = Number(url.searchParams.get('__size')), requestCap = Number(url.searchParams.get('__cap'));
      assert.ok(datasets.has(size)); assert.equal(requestCap, cap);
      assert.equal(url.searchParams.get('user_id'), `eq.${account}`);
      assert.equal(url.searchParams.get('select'), '*');
      assert.equal(url.searchParams.get('order'), 'test_date.desc,id.desc');
      const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
      assert.ok(Number.isSafeInteger(offset) && offset >= 0); assert.equal(limit, 500);
      const authorized = ordered(datasets.get(size).filter(row => row.user_id === account));
      const rows = authorized.slice(offset, offset + Math.min(limit, cap));
      const json = Buffer.from(JSON.stringify(rows)), compressed = gzipSync(json);
      const exact = req.headers.prefer?.includes('count=exact') ?? false;
      assert.equal(exact, offset === 0);
      requests.push({ size, offset, limit, exact, ids: rows.map(row => row.id), bytes: json.length, gzip: compressed.length });
      // Deterministic response delay; local transport/parse remain real. CDP's
      // network emulator reported decoded bytes as transferred in this Chrome,
      // so do not silently equate its throughput model with compressed traffic.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip',
          'Content-Length': compressed.length, 'Cache-Control': 'no-store',
          'Content-Range': `${offset}-${offset + rows.length - 1}/${exact ? authorized.length : '*'}` });
        res.end(compressed);
      }, latency + compressed.length / (mbps * 1000000 / 8) * 1000);
      return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const name = url.pathname === '/' ? html : url.pathname.slice(1);
    assert.ok(files.has(name), `Unknown fixture resource ${name}`);
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.setHeader('Cache-Control', name === html ? 'no-store' : 'public, max-age=3600');
    res.end(files.get(name));
  } catch (error) {
    violations.push(error.message); res.writeHead(400); res.end(error.message);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--disable-background-networking',
  '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000',
  `--user-data-dir=${join(folder, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sockets = [], errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 400; i++) { const result = await fn(); if (result) return result; await delay(25); }
  throw new Error('Browser startup timed out');
}
async function connect(url, page = true) {
  const socket = new WebSocket(url); sockets.push(socket);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
    if (!msg.id) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`)); else p.resolve(msg.result);
  };
  socket.onclose = () => { pending.forEach(p => p.reject(new Error('Browser closed'))); pending.clear(); };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const request = ++id; pending.set(request, { resolve, reject, method }); socket.send(JSON.stringify({ id: request, method, params }));
  });
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  if (page) await call('Runtime.enable'); return { call, evaluate };
}
const trials = [];
let manager;
try {
  const port = await until(async () => { try { return Number((await readFile(join(folder, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { return null; } });
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  manager = await connect(version.webSocketDebuggerUrl, false);
  const environment = { date: new Date().toISOString(), base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version, os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model,
    logicalCPUs: os.cpus().length, ramGiB: os.totalmem() / 2 ** 30, browser: await manager.call('Browser.getVersion'),
    runs, sizes, cap, latencyMs: latency, megabitsPerSecond: mbps, cpuThrottling: 1, label, profiling, historyRef, sourceHash, expectSortReads, pagination,
    networkModel: 'Server delays each GET by latency + gzip bytes / throughput; no CDP network throttling; localhost burst delivery',
    build: 'Vite production, minified React 18; History + real CSS + installed Supabase SDK; fixture auth/local GET API',
  };
  console.log(JSON.stringify(environment));
  for (let repeat = 0; repeat < runs; repeat++) {
    // Rotate sizes to reduce systematic warm-up / thermal order bias.
    const rotation = sizes.map((_, i) => sizes[(i + repeat) % sizes.length]);
    for (const size of rotation) {
      const { browserContextId } = await manager.call('Target.createBrowserContext');
      const { targetId } = await manager.call('Target.createTarget', { url: 'about:blank', browserContextId });
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = await connect(targets.find(t => t.id === targetId).webSocketDebuggerUrl);
      await page.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.call('Emulation.setLocaleOverride', { locale: 'en-US' });
      await page.call('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
      await page.call('Network.enable');
      await page.call('Performance.enable');
      await page.call('Page.navigate', { url: `${origin}/?size=${size}&cap=${cap}` });
      await until(() => page.evaluate('!!window.benchmark'));
      const metrics = async () => Object.fromEntries((await page.call('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      const trial = { size, repeat, idleFrames: await page.evaluate('benchmark.frames()'), actions: [] };
      let direction = 'all', score = 'all', sortBy = 'date', sortOrder = 'desc';
      let displayPage = 0, pageSize = 25;
      async function action(name, kind, value = null, expected = size) {
        if (kind === 'select' && value.index === 0) direction = value.value;
        if (kind === 'select' && value.index === 1) score = value.value;
        if (kind === 'select' && value.index === 2) sortBy = value.value;
        if (kind === 'select' && value.index === 3) sortOrder = value.value;
        const visible = ordered(fixtures(size)).filter(row => (direction === 'all' || row.test_direction === direction) &&
          (score === 'all' || (score === 'high' ? row.correct_count / row.total_words >= .8 :
            score === 'medium' ? row.correct_count / row.total_words >= .5 && row.correct_count / row.total_words < .8 :
              row.correct_count / row.total_words < .5)));
        visible.sort((a, b) => {
          const delta = sortBy === 'date' ? Date.parse(a.test_date) - Date.parse(b.test_date)
            : a.correct_count / a.total_words - b.correct_count / b.total_words;
          return sortOrder === 'asc' ? delta : -delta;
        });
        assert.equal(visible.length, expected);
        if (kind === 'open' || (kind === 'select' && value.index < 4)) displayPage = 0;
        if (kind === 'page') displayPage += value.direction === 'Next' ? 1 : -1;
        if (kind === 'select' && value.index === 4) {
          displayPage = Math.floor(displayPage * pageSize / Number(value.value));
          pageSize = Number(value.value);
        }
        const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
        displayPage = Math.min(displayPage, totalPages - 1);
        const rendered = pagination ? visible.slice(displayPage * pageSize, (displayPage + 1) * pageSize) : visible;
        const expectedPagination = pagination ? { page: displayPage, size: pageSize, totalPages } : null;
        const profileThis = profiling && ['cold-open', 'select-all', 'expand'].includes(name);
        if (profileThis) { await page.call('Profiler.enable'); await page.call('Profiler.start'); }
        const before = await metrics(), requestStart = requests.length;
        const result = await page.evaluate(`benchmark.action(${JSON.stringify(kind)},${JSON.stringify(value)},${JSON.stringify(rendered.map(row => row.id))},${visible.length},${JSON.stringify(expectedPagination)})`);
        const after = await metrics();
        const profile = profileThis ? (await page.call('Profiler.stop')).profile : null;
        assert.equal(Number.parseInt(result.stats[1]), Math.round(visible.reduce((sum, row) => sum + row.correct_count / row.total_words * 100, 0) / visible.length));
        assert.equal(Number(result.stats[2]), visible.reduce((sum, row) => sum + row.total_words, 0));
        const readRequests = requests.slice(requestStart);
        assert.equal(result.requestCount, readRequests.length);
        assert.equal(readRequests.length, kind === 'open' || (expectSortReads && kind === 'select' && value.index >= 2)
          ? Math.ceil(size / Math.min(500, cap)) : 0, 'Unexpected read count for this interaction');
        if (readRequests.length) {
          assert.deepEqual(readRequests.flatMap(r => r.ids), ordered(fixtures(size)).map(r => r.id));
          assert.equal(readRequests.length, Math.ceil(size / Math.min(500, cap)));
        }
        const cpu = Object.fromEntries(['ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(key => [key, (after[key] - before[key]) * 1000]));
        const record = { name, ...result, cpu, jsonBytes: readRequests.reduce((n, r) => n + r.bytes, 0),
          gzipBytes: readRequests.reduce((n, r) => n + r.gzip, 0) };
        if (profile) {
          record.profile = profileSummary(profile);
          await writeFile(resolve(`tmp/history-perf-${label}-${size}-${repeat}-${name}.cpuprofile`), JSON.stringify(profile));
        }
        trial.actions.push(record); return record;
      }
      await action('cold-open', 'open');
      trial.dom = await page.evaluate('benchmark.inspect()');
      assert.equal(trial.dom.rows, pagination ? Math.min(size, 25) : size); assert.ok(trial.dom.rowHeight > 80, 'Real CSS must be applied');
      await page.call('HeapProfiler.collectGarbage');
      trial.loadedHeap = await page.call('Runtime.getHeapUsage');
      await page.evaluate('benchmark.leave()');
      await page.call('HeapProfiler.collectGarbage');
      trial.unmountedHeap = await page.call('Runtime.getHeapUsage');
      await action('warm-open', 'open');
      if (screenshots && repeat === 0) {
        trial.layoutChecks = [];
        for (const width of [1440, 390]) {
          await page.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
          await page.evaluate(`document.querySelector('[aria-label="History display controls"]')?.scrollIntoView()`);
          const dimensions = await page.evaluate('({ width: innerWidth, contentWidth: document.documentElement.scrollWidth })');
          assert.ok(dimensions.contentWidth <= dimensions.width, 'Horizontal overflow');
          trial.layoutChecks.push(dimensions);
          const shot = await page.call('Page.captureScreenshot', { format: 'png' });
          await writeFile(resolve(`tmp/history-perf-${label}-${size}-${width}.png`), Buffer.from(shot.data, 'base64'));
        }
        await page.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await page.evaluate('window.scrollTo(0,0)');
      }
      if (pagination) {
        await action('next-top', 'page', { position: 'top', direction: 'Next' });
        await action('next-bottom', 'page', { position: 'bottom', direction: 'Next' });
        await action('previous-bottom', 'page', { position: 'bottom', direction: 'Previous' });
        await action('previous-top', 'page', { position: 'top', direction: 'Previous' });
        await action('position-next-1', 'page', { position: 'top', direction: 'Next' });
        await action('position-next-2', 'page', { position: 'top', direction: 'Next' });
        for (const size of [50, 10, 100, 25]) await action(`page-size-${size}`, 'select', { index: 4, value: String(size) });
      }
      const expected = (direction = 'all', score = 'all') => fixtures(size).filter(r =>
        (direction === 'all' || r.test_direction === direction) && (score === 'all' ||
        (score === 'high' ? r.correct_count / r.total_words >= .8 : score === 'medium' ? r.correct_count / r.total_words >= .5 && r.correct_count / r.total_words < .8 : r.correct_count / r.total_words < .5))).length;
      for (const direction of ['en-to-geo', 'geo-to-en', 'all'])
        await action(`direction-${direction}`, 'select', { index: 0, value: direction }, expected(direction));
      for (const score of ['high', 'medium', 'low', 'all'])
        await action(`score-filter-${score}`, 'select', { index: 1, value: score }, expected('all', score));
      await action('date-asc', 'select', { index: 3, value: 'asc' });
      await action('date-desc', 'select', { index: 3, value: 'desc' });
      await action('score-desc', 'select', { index: 2, value: 'score' });
      await action('score-asc', 'select', { index: 3, value: 'asc' });
      await action('select-all', 'selection', 'Select All');
      await action('deselect-all', 'selection', 'Deselect All');
      await action('expand', 'expand'); await action('collapse', 'collapse');
      await page.evaluate('benchmark.startScroll()');
      // Same distance fits both the default 25-row list and the baseline.
      await page.call('Input.synthesizeScrollGesture', { x: 1000, y: 600, yDistance: -1000, speed: 1500, gestureSourceType: 'mouse' });
      trial.scroll = await page.evaluate('benchmark.endScroll()');
      await page.call('HeapProfiler.collectGarbage');
      trial.finalHeap = await page.call('Runtime.getHeapUsage');
      if (pagination) {
        const allIds = ordered(fixtures(size)).sort((a, b) => a.correct_count / a.total_words - b.correct_count / b.total_words).map(row => row.id);
        trial.pageCoverage = await page.evaluate(`benchmark.visitAllPages(${JSON.stringify(allIds)})`);
      }
      await page.evaluate('benchmark.leave()');
      await page.call('HeapProfiler.collectGarbage');
      trial.finalUnmountedHeap = await page.call('Runtime.getHeapUsage');
      assert.deepEqual(errors, []); assert.deepEqual(violations, []);
      trials.push(trial);
      const result = { environment, trials, safety: { violations, runtimeErrors: errors, mutations: 0 } };
      await writeFile(resolve(`tmp/history-perf-${label}.json`), JSON.stringify(result, null, 2));
      console.log(`run ${repeat + 1}/${runs}, ${size}: cold ${trial.actions[0].duration.toFixed(1)} ms, warm ${trial.actions[1].duration.toFixed(1)} ms, DOM ${trial.dom.nodes}`);
      await manager.call('Target.disposeBrowserContext', { browserContextId });
    }
  }
  console.log(`Complete: ${trials.length} cold/warm pairs. Results: tmp/history-perf-${label}.json`);
} finally {
  await manager?.call('Browser.close').catch(() => {});
  sockets.forEach(socket => socket.close()); browser.kill(); server.closeAllConnections(); server.close();
}
