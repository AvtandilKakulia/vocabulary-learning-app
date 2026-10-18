// Repeat the installed Vitest CLI in fresh processes, without changing its config.
// node scripts/audit-test-runs.mjs <full|history|reguess|practice|mixed> <default|1|2> <repetitions>
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { availableParallelism, cpus, freemem, totalmem, release, platform } from 'node:os';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const groups = {
  full: [],
  history: ['src/components/History.pagination.test.tsx'],
  reguess: ['src/components/FreeMode.reguess.test.tsx'],
  practice: ['src/components/FreeMode.test.tsx'],
  mixed: ['src/components/History.pagination.test.tsx', 'src/components/FreeMode.reguess.test.tsx', 'src/components/FreeMode.test.tsx'],
};
const [group, workers, count] = process.argv.slice(2);
const repetitions = Number(count);
if (!Object.hasOwn(groups, group) || !['default', '1', '2'].includes(workers) ||
    !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) {
  throw new Error('Usage: node scripts/audit-test-runs.mjs <full|history|reguess|practice|mixed> <default|1|2> <1..20>');
}
const root = process.cwd();
const vitest = resolve(root, 'node_modules/vitest/vitest.mjs');
const packageInfo = JSON.parse(await readFile(resolve(root, 'node_modules/vitest/package.json'), 'utf8'));
const outputRoot = resolve(root, 'tmp/r3-qa-01');
await mkdir(outputRoot, { recursive: true });
const directory = await mkdtemp(join(outputRoot, `${group}-${workers}-`));
const summary = {
  environment: { node: process.version, vitest: packageInfo.version, platform: platform(), release: release(),
    cpu: cpus()[0]?.model, logicalCpus: cpus().length, availableParallelism: availableParallelism(),
    totalMemoryGiB: totalmem() / 2 ** 30 },
  group, workers, repetitions, runs: [],
};
console.log(`Audit output: ${directory}`);
for (let index = 1; index <= repetitions; index++) {
  const report = join(directory, `${index}.json`);
  const log = createWriteStream(join(directory, `${index}.log`));
  const args = [vitest, 'run', ...groups[group], ...(workers === 'default' ? [] : [`--maxWorkers=${workers}`]),
    '--reporter=default', '--reporter=json', `--outputFile.json=${report}`];
  const started = performance.now();
  let minFreeMemoryGiB = freemem() / 2 ** 30;
  const sample = setInterval(() => { minFreeMemoryGiB = Math.min(minFreeMemoryGiB, freemem() / 2 ** 30); }, 1000);
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let exitCode;
  try {
    exitCode = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
  } finally {
    clearInterval(sample);
    await new Promise(accept => log.end(accept));
  }
  const elapsedSeconds = (performance.now() - started) / 1000;
  let result = {};
  try { result = JSON.parse(await readFile(report, 'utf8')); }
  catch { /* Preserve crashes/missing reports as failed runs, never as zero-test passes. */ }
  const assertions = (result.testResults ?? []).flatMap(file => file.assertionResults.map(test => ({ file: file.name, ...test })));
  const run = { index, exitCode, elapsedSeconds, minFreeMemoryGiB,
    passed: result.numPassedTests ?? null, failed: result.numFailedTests ?? null, pending: result.numPendingTests ?? null,
    failures: assertions.filter(test => test.status === 'failed').map(({ file, fullName, duration, failureMessages }) =>
      ({ file, fullName, duration, failureMessages })),
    slowest: [...assertions].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0)).slice(0, 8)
      .map(({ file, fullName, duration }) => ({ file, fullName, duration })),
  };
  summary.runs.push(run);
  await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(run));
}
process.exitCode = summary.runs.some(run => run.exitCode !== 0 || run.failed !== 0 || run.passed === null) ? 1 : 0;
