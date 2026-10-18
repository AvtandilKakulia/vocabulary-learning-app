// Built separately in production mode. Imports the unchanged History component.
import React from 'react';
import { createRoot } from 'react-dom/client';
import History from '../../src/components/History';
import '../../src/index.css';

const root = createRoot(document.getElementById('root'));
const rows = () => document.querySelector('#root .overflow-hidden > div');
const rowCount = () => rows()?.firstElementChild?.classList.contains('border-b') ? rows().childElementCount : 0;
const toolbar = () => document.querySelector('[aria-label="History selection toolbar"]');
const button = name => [...toolbar().querySelectorAll('button')].find(b => b.textContent.trim() === name ||
  (name === 'Select All' && /^Select All \d+ Filtered Records$/.test(b.textContent.trim())));
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const check = (ok, message) => { if (!ok) throw new Error(message); };
// New rows expose their ID. The immutable, pre-pagination baseline still needs
// React 18's keyed host node; never infer identity from non-unique visible text.
function renderedIds() {
  const children = [...(rows()?.children ?? [])];
  const fiber = children[0] && Object.keys(children[0]).find(key => key.startsWith('__reactFiber$'));
  check(fiber, 'Cannot inspect rendered row keys with this React version');
  return children.map(row => { const id = row.dataset.historyId ?? row[fiber]?.key; check(typeof id === 'string', 'Missing rendered row key'); return id; });
}
const longTasks = [];
let scrolling = false, scrollFrames = [], lastScrollFrame, scrollStarted;
new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))))
  .observe({ type: 'longtask', buffered: true });

async function painted(predicate) {
  const deadline = performance.now() + 60000;
  for (;;) {
    check(performance.now() < deadline, 'UI completion deadline exceeded');
    if (predicate()) {
      // Recheck after paint: the baseline can briefly sort its old list before
      // an effect starts the refetch. That intermediate render is not completion.
      await frame(); await frame();
      if (predicate()) return;
    }
    await frame();
  }
}

window.benchmark = {
  rowCount,
  async action(kind, value, expectedIds, expectedCount, pagination) {
    const expectedRows = expectedIds.length;
    const start = performance.now();
    const requestStart = window.auditRequests.length;
    if (kind === 'open') root.render(<History />);
    else if (kind === 'select') {
      const control = document.querySelectorAll('select')[value.index];
      check(control && control.value !== value.value, 'Select must change');
      control.value = value.value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (kind === 'page') {
      const control = [...document.querySelectorAll(`[aria-label="History pagination (${value.position})"] button`)]
        .find(button => button.textContent === value.direction);
      check(control && !control.disabled, 'Page action must be available');
      control.click();
    } else if (kind === 'selection') button(value).click();
    else if (kind === 'expand') rows().querySelector('.lucide-chevron-down').closest('button').click();
    else if (kind === 'collapse') rows().querySelector('.lucide-chevron-up').closest('button').click();
    else throw new Error('Unknown benchmark action');
    await painted(() => {
      if (rowCount() !== expectedRows) return false;
      if (!renderedIds().every((id, index) => id === expectedIds[index])) return false;
      if (pagination) {
        const { page, size, totalPages } = pagination;
        const controls = document.querySelector('[aria-label="History display controls"]');
        if (!controls?.textContent.includes(`Showing ${page * size + 1}–${Math.min((page + 1) * size, expectedCount)} of ${expectedCount} records`)) return false;
        const navigation = [...document.querySelectorAll('nav[aria-label^="History pagination"]')];
        check(navigation.length === (totalPages > 1 ? 2 : 0), 'Top/bottom navigation mismatch');
        for (const nav of navigation) {
          if (!nav.textContent.includes(`Page ${page + 1} of ${totalPages}`)) return false;
          const buttons = nav.querySelectorAll('button');
          check(buttons[0].disabled === (page === 0) && buttons[1].disabled === (page === totalPages - 1), 'Incorrect navigation boundaries');
        }
        if (totalPages === 1) check(controls.textContent.includes('Page 1 of 1'), 'Missing single-page indicator');
        check(rowCount() <= size && rowCount() <= 100, 'Unbounded rendered list');
      }
      if (kind === 'selection') return !!button(value === 'Select All' ? 'Deselect All' : 'Select All');
      if (kind === 'expand') return !!rows().querySelector('.lucide-chevron-up');
      if (kind === 'collapse') return !rows().querySelector('.lucide-chevron-up');
      if (kind === 'open') {
        const requests = window.auditRequests.slice(requestStart);
        return requests.length > 0 && requests.every(r => r.bodyEnd) && !button('Select All')?.disabled;
      }
      if (kind === 'select' && value.index >= 2)
        return window.auditRequests.slice(requestStart).every(r => r.bodyEnd) && !button('Select All')?.disabled;
      return true;
    });
    const end = performance.now();
    check(renderedIds().every((id, index) => id === expectedIds[index]), 'Rendered order changed before completion');
    const requests = window.auditRequests.slice(requestStart);
    const resources = performance.getEntriesByType('resource').filter(r => r.startTime >= start && r.name.includes('/rest/v1/'));
    const networkEnd = resources.length ? Math.max(...resources.map(r => r.responseEnd)) : null;
    const bodyEnd = requests.length ? Math.max(...requests.map(r => r.bodyEnd)) : null;
    const stats = [...document.querySelectorAll('.text-4xl')].map(el => el.textContent);
    check(Number(stats[0]) === expectedCount, 'Statistics/full filtered collection mismatch');
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
  // Complete page coverage belongs in a real browser too. This unmeasured walk
  // checks every ID, full statistics, boundaries and range, even at 5,000 rows.
  async visitAllPages(expectedIds) {
    const size = Number(document.querySelectorAll('select')[4].value);
    const pages = Math.ceil(expectedIds.length / size);
    const stats = [...document.querySelectorAll('.text-4xl')].map(el => el.textContent);
    const requestCount = window.auditRequests.length;
    for (let page = 0; page < pages; page++) {
      const slice = expectedIds.slice(page * size, (page + 1) * size);
      await painted(() => rowCount() === slice.length && renderedIds().every((id, index) => id === slice[index]));
      check(JSON.stringify([...document.querySelectorAll('.text-4xl')].map(el => el.textContent)) === JSON.stringify(stats), 'Page changed full statistics');
      check(document.querySelector('[aria-label="History display controls"]').textContent.includes(
        `Showing ${page * size + 1}–${Math.min((page + 1) * size, expectedIds.length)} of ${expectedIds.length} records`), 'Wrong range during full page walk');
      for (const position of ['top', 'bottom']) {
        const nav = document.querySelector(`[aria-label="History pagination (${position})"]`);
        check(nav.textContent.includes(`Page ${page + 1} of ${pages}`), 'Wrong page number');
        check(nav.querySelectorAll('button')[0].disabled === (page === 0), 'Wrong Previous boundary');
        check(nav.querySelectorAll('button')[1].disabled === (page === pages - 1), 'Wrong Next boundary');
      }
      if (page < pages - 1) document.querySelector('[aria-label="History pagination (top)"]').querySelectorAll('button')[1].click();
    }
    check(window.auditRequests.length === requestCount, 'Page walk refetched History');
    return { pages, checkedIds: expectedIds.length, size, reads: 0 };
  },
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
