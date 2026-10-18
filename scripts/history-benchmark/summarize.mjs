// node scripts/history-benchmark/summarize.mjs tmp/history-perf-controlled.json
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const document = JSON.parse(await readFile(process.argv[2], 'utf8'));
// Optional third argument selects before/after from the published comparison.
const input = process.argv[3] ? document[process.argv[3]] : document;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const round = value => Math.round(value * 10) / 10;
const stats = values => ({ median: round(median(values)), p95: round(percentile(values, .95)) });
const results = input.environment.sizes.map(size => {
  const trials = input.trials.filter(t => t.size === size);
  const actions = Object.fromEntries(trials[0].actions.map(({ name }) => {
    const samples = trials.map(t => t.actions.find(a => a.name === name));
    // Report request/byte counts only if every repetition agrees, including zero.
    for (const key of ['requestCount', 'jsonBytes', 'gzipBytes'])
      assert.ok(samples.every(sample => sample[key] === samples[0][key]), `${size}/${name}: inconsistent ${key}`);
    return [name, {
      duration: stats(samples.map(a => a.duration)), retrieval: stats(samples.map(a => a.retrieval)),
      postNetwork: samples[0].postNetwork === null ? null : stats(samples.map(a => a.postNetwork)),
      script: stats(samples.map(a => a.cpu.ScriptDuration)),
      layoutStyle: stats(samples.map(a => a.cpu.LayoutDuration + a.cpu.RecalcStyleDuration)),
      task: stats(samples.map(a => a.cpu.TaskDuration)),
      maxLongTask: stats(samples.map(a => Math.max(0, ...a.longTasks.map(t => t.duration)))),
      requests: samples[0].requestCount, jsonBytes: samples[0].jsonBytes, gzipBytes: samples[0].gzipBytes,
    }];
  }));
  const frames = trials.flatMap(t => t.scroll.gaps);
  return { size, samples: trials.length, actions, dom: trials[0].dom,
    loadedHeapMiB: stats(trials.map(t => t.loadedHeap.usedSize / 2 ** 20)),
    afterUnmountHeapMiB: stats(trials.map(t => t.unmountedHeap.usedSize / 2 ** 20)),
    finalHeapMiB: stats(trials.map(t => t.finalHeap.usedSize / 2 ** 20)),
    finalUnmountedHeapMiB: stats(trials.map(t => t.finalUnmountedHeap.usedSize / 2 ** 20)),
    scroll: { frameMs: stats(frames), maxFrameMs: round(Math.max(...frames)),
      over33msPercent: round(frames.filter(ms => ms > 33.4).length / frames.length * 100),
      samples: frames.length, distance: trials[0].scroll.distance },
  };
});
console.log(JSON.stringify({ environment: input.environment, results, safety: input.safety }, null, 2));
