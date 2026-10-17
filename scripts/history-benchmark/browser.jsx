// Built separately in production mode. Imports the unchanged History component.
import React from 'react';
import { createRoot } from 'react-dom/client';
import History from '../../src/components/History';
import '../../src/index.css';

const root = createRoot(document.getElementById('root'));
const rows = () => document.querySelector('#root .overflow-hidden > div');
const rowCount = () => rows()?.firstElementChild?.classList.contains('border-b') ? rows().childElementCount : 0;
const toolbar = () => document.querySelector('[aria-label="History selection toolbar"]');
const button = name => [...toolbar().querySelectorAll('button')].find(b => b.textContent.trim() === name);
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const longTasks = [];
let scrolling = false, scrollFrames = [], lastScrollFrame, scrollStarted;
new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))))
  .observe({ type: 'longtask', buffered: true });

async function painted(predicate) {
  const deadline = performance.now() + 60000;
  while (!predicate()) {
    check(performance.now() < deadline, 'UI completion deadline exceeded');
    await frame();
  }
  // One intervening paint, then another frame where the main thread is available.
  await frame(); await frame();
}

window.benchmark = {
  rowCount,
  async action(kind, value, expectedRows) {
    const start = performance.now();
    const requestStart = window.auditRequests.length;
    if (kind === 'open') root.render(<History />);
    else if (kind === 'select') {
      const control = document.querySelectorAll('select')[value.index];
      check(control && control.value !== value.value, 'Select must change');
      control.value = value.value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (kind === 'selection') button(value).click();
    else if (kind === 'expand') rows().querySelector('.lucide-chevron-down').closest('button').click();
    else if (kind === 'collapse') rows().querySelector('.lucide-chevron-up').closest('button').click();
    else throw new Error('Unknown benchmark action');
    await painted(() => {
      if (rowCount() !== expectedRows) return false;
      if (kind === 'selection') return !!button(value === 'Select All' ? 'Deselect All' : 'Select All');
      if (kind === 'expand') return !!rows().querySelector('.lucide-chevron-up');
      if (kind === 'collapse') return !rows().querySelector('.lucide-chevron-up');
      if (kind === 'open' || (kind === 'select' && value.index >= 2)) {
        const requests = window.auditRequests.slice(requestStart);
        return requests.length > 0 && requests.every(r => r.bodyEnd) && !button('Select All')?.disabled;
      }
      return true;
    });
    const end = performance.now();
    const requests = window.auditRequests.slice(requestStart);
    const resources = performance.getEntriesByType('resource').filter(r => r.startTime >= start && r.name.includes('/rest/v1/'));
    const networkEnd = resources.length ? Math.max(...resources.map(r => r.responseEnd)) : null;
    const bodyEnd = requests.length ? Math.max(...requests.map(r => r.bodyEnd)) : null;
    const stats = [...document.querySelectorAll('.text-4xl')].map(el => el.textContent);
    check(Number(stats[0]) === expectedRows, 'Statistics/visible rows mismatch');
    return {
      start, end, duration: end - start, requestCount: requests.length,
      retrieval: networkEnd === null ? 0 : networkEnd - requests[0].start,
      postNetwork: networkEnd === null ? null : end - networkEnd,
      postBody: bodyEnd === null ? null : end - bodyEnd,
      requests, resources: resources.map(r => ({ start: r.startTime, end: r.responseEnd,
        transfer: r.transferSize, encoded: r.encodedBodySize, decoded: r.decodedBodySize })),
      longTasks: longTasks.filter(t => t.start >= start && t.start < end), stats,
    };
  },
  async leave() { root.render(null); await painted(() => !document.querySelector('#root').firstChild); },
  async startScroll() {
    window.scrollTo(0, 0); await frame(); await frame();
    scrolling = true; scrollFrames = []; lastScrollFrame = scrollStarted = performance.now();
    const sample = now => {
      if (!scrolling) return;
      scrollFrames.push(now - lastScrollFrame); lastScrollFrame = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  },
  async endScroll() {
    scrolling = false;
    const result = { gaps: scrollFrames.slice(1), distance: scrollY, duration: performance.now() - scrollStarted };
    check(result.distance > 0, 'Native scroll gesture must move the page');
    window.scrollTo(0, 0); await frame(); await frame();
    return result;
  },
  async frames() {
    const gaps = []; let last = performance.now();
    for (let i = 0; i < 60; i++) { await frame(); const now = performance.now(); gaps.push(now - last); last = now; }
    return gaps;
  },
  inspect() {
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    let nodes = 0; while (walker.nextNode()) nodes++;
    return { nodes, elements: document.querySelectorAll('*').length, rows: rowCount(),
      height: document.documentElement.scrollHeight, viewport: [innerWidth, innerHeight],
      rowHeight: rows()?.firstElementChild?.getBoundingClientRect().height,
      stats: [...document.querySelectorAll('.text-4xl')].map(el => el.textContent) };
  },
};
