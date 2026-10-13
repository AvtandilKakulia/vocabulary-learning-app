// Dependency-free integration runner. Never accepts a DB URL or an existing DB.
// Requires PostgreSQL server binaries (initdb, pg_ctl, psql) and Node >= 20.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.resolve(here, '../../migrations');
const migrationName = '20261013211615_advance_word_updated_at.sql';
const migration = path.join(migrations, migrationName);
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--pg-bin'), 'Usage: node run.mjs [--pg-bin /path/to/bin]');
const bin = args[1] ?? '';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PG')));
env.PGTZ = 'UTC';
env.PGCLIENTENCODING = 'UTF8';
const executable = name => bin ? path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
function run(name, argv, allowFailure = false) {
  // A daemon inheriting Node's capture pipes keeps spawnSync waiting on Windows.
  // pg_ctl writes server diagnostics to the explicit -l file instead.
  const result = spawnSync(executable(name), argv, { env, encoding: 'utf8', windowsHide: true, timeout: 60000,
    ...(name === 'pg_ctl' && argv.includes('start') ? { stdio: 'ignore' } : {}),
  });
  if (result.error) throw result.error;
  if (!allowFailure) assert.equal(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
  return result;
}
for (const name of ['initdb', 'pg_ctl', 'psql']) run(name, ['--version']);
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const tempRoot = path.resolve(os.tmpdir());
const directory = mkdtempSync(path.join(tempRoot, 'r3-a01-pg-'));
const data = path.join(directory, 'data');
const psqlArgs = db => ['-X', '-w', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = (db, text) => run('psql', [...psqlArgs(db), '-c', text]).stdout.trim();
const file = (db, name, allowFailure = false) => run('psql', [...psqlArgs(db), '-f', name], allowFailure);
let passed = 0;
const pass = name => { passed++; console.log(`PASS ${name}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = new Set();
function session(db, text) {
  const child = spawn(executable('psql'), psqlArgs(db), { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => { children.delete(child); resolve({ code, stdout, stderr }); });
  });
  child.stdin.write(text + '\n');
  return { child, done, output: () => stdout };
}
async function until(predicate, label) {
  const end = Date.now() + 10000;
  while (!(await predicate())) {
    assert(Date.now() < end, `Timed out: ${label}`);
    await pause(50);
  }
}
let started = false;
try {
  run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  appendFileSync(path.join(data, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\ntimezone = 'UTC'\n`);
  started = true;
  run('pg_ctl', ['-D', data, '-l', path.join(directory, 'server.log'), '-w', '-t', '20', 'start']);
  console.log(sql('postgres', 'SELECT version()'));
  console.log(`Isolated cluster: ${directory}; loopback port ${port}`);
  sql('postgres', 'CREATE DATABASE r3a01_fixture');
  file('r3a01_fixture', path.join(here, 'fixture.sql'));
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql') && name < migrationName).sort()) {
    file('r3a01_fixture', path.join(migrations, name));
  }
  sql('r3a01_fixture', `
    INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
    INSERT INTO public.words (id, user_id, english_word, description, updated_at) VALUES
      ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Yield', 'original A', '2000-01-01 00:00:00.123456+00'),
      ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Yield', 'original B', '2000-01-01 00:00:00.123456+00');`);
  let sequence = 0;
  const fresh = () => {
    const db = `r3a01_case_${++sequence}`;
    sql('postgres', `CREATE DATABASE ${db} TEMPLATE r3a01_fixture`);
    return db;
  };
  // Capture existing data, owners, ACLs, RLS, policies, constraints, indexes,
  // function bodies/configuration, and the normalization/profile trigger OIDs.
  // A migration failure must preserve even the timestamp trigger and new funcs.
  function snapshot(db, includeTimestamp = false) {
    return sql(db, `SELECT jsonb_build_object(
      'words', (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.words w),
      'profiles', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.profiles p),
      'tables', (SELECT jsonb_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity) ORDER BY oid) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'),
      'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p),
      'constraints', (SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c WHERE connamespace='public'::regnamespace),
      'indexes', (SELECT jsonb_agg(to_jsonb(i) ORDER BY indexname) FROM pg_indexes i WHERE schemaname='public'),
      'functions', (SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='public'::regnamespace ${includeTimestamp ? '' : "AND proname <> 'advance_word_updated_at'"}),
      'triggers', (SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t WHERE tgrelid IN ('public.words'::regclass,'public.profiles'::regclass) ${includeTimestamp ? '' : "AND tgname <> 'update_words_updated_at'"})
    )`);
  }
  const db = fresh();
  const before = snapshot(db);
  file(db, migration);
  assert.equal(snapshot(db), before);
  assert.equal(sql(db, "SELECT count(*) FROM pg_namespace WHERE nspname='supabase_migrations'"), '0');
  pass('migration preserves all existing rows, objects, privileges, RLS and ledger absence');
  file(db, path.join(here, 'behavior.sql'));
  pass('normal, same-transaction, future-clock, precision, stale/fresh, normalization, profiles, RLS and invalid-runtime SQL assertions');
  const version1 = sql(db, "UPDATE public.words SET description='rapid 1' WHERE id='10000000-0000-0000-0000-000000000001' RETURNING updated_at");
  const version2 = sql(db, "UPDATE public.words SET description='rapid 2' WHERE id='10000000-0000-0000-0000-000000000001' RETURNING updated_at");
  assert.equal(sql(db, `SELECT '${version2}'::timestamptz > '${version1}'::timestamptz`), 't');
  pass('rapid updates in separate transactions advance');

  for (const endA of ['COMMIT', 'ROLLBACK']) {
    const token = sql(db, "SELECT updated_at FROM public.words WHERE id='10000000-0000-0000-0000-000000000001'");
    const predicate = `id='10000000-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000001' AND updated_at='${token}'`;
    const a = session(db, `BEGIN ISOLATION LEVEL READ COMMITTED; UPDATE public.words SET description='writer A' WHERE ${predicate};\n\\echo A_READY`);
    await until(() => a.output().includes('A_READY'), 'writer A has updated and holds row lock');
    const b = session(db, `SET application_name='r3a01_writer_b'; BEGIN ISOLATION LEVEL READ COMMITTED; WITH changed AS (UPDATE public.words SET description='writer B' WHERE ${predicate} RETURNING id) SELECT count(*) FROM changed; COMMIT;\n\\q`);
    b.child.stdin.end();
    await until(() => sql(db, "SELECT count(*) FROM pg_stat_activity WHERE application_name='r3a01_writer_b' AND cardinality(pg_blocking_pids(pid))>0") === '1', 'writer B is actually blocked on A');
    a.child.stdin.end(`${endA};\n\\q\n`);
    const [aResult, bResult] = await Promise.all([a.done, b.done]);
    assert.equal(aResult.code, 0, aResult.stderr);
    assert.equal(bResult.code, 0, bResult.stderr);
    assert.equal(bResult.stdout.trim(), endA === 'COMMIT' ? '0' : '1');
    assert.equal(sql(db, "SELECT description FROM public.words WHERE id='10000000-0000-0000-0000-000000000001'"), endA === 'COMMIT' ? 'writer A' : 'writer B');
    pass(`real blocked concurrent UPDATE after A ${endA}: B ${endA === 'COMMIT' ? 'rejected' : 'allowed'}`);
  }

  const driftCases = [
    ['precision 3', 'ALTER TABLE public.words ALTER COLUMN updated_at TYPE timestamptz(3)', 'full-precision'],
    ['nullable', 'ALTER TABLE public.words ALTER COLUMN updated_at DROP NOT NULL', 'full-precision'],
    ['missing timestamp column', 'ALTER TABLE public.words DROP COLUMN updated_at', 'full-precision'],
    ['timestamp without zone', 'ALTER TABLE public.words ALTER COLUMN updated_at TYPE timestamp', 'full-precision'],
    ['nonfinite existing version', "ALTER TABLE public.words DISABLE TRIGGER update_words_updated_at; UPDATE public.words SET updated_at='infinity'; ALTER TABLE public.words ENABLE TRIGGER update_words_updated_at", 'invalid word versions'],
    ['missing timestamp trigger', 'DROP TRIGGER update_words_updated_at ON public.words', 'unexpected words triggers'],
    ['disabled timestamp trigger', 'ALTER TABLE public.words DISABLE TRIGGER update_words_updated_at', 'unexpected words triggers'],
    ['replica timestamp trigger', 'ALTER TABLE public.words ENABLE REPLICA TRIGGER update_words_updated_at', 'unexpected words triggers'],
    ['missing normalization trigger', 'DROP TRIGGER trg_set_english_word_norm ON public.words', 'unexpected words triggers'],
    ['disabled normalization trigger', 'ALTER TABLE public.words DISABLE TRIGGER trg_set_english_word_norm', 'unexpected words triggers'],
    ['extra trigger', 'CREATE TRIGGER z_override BEFORE UPDATE ON public.words FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', 'unexpected words triggers'],
    ['column-specific timestamp trigger', 'DROP TRIGGER update_words_updated_at ON public.words; CREATE TRIGGER update_words_updated_at BEFORE UPDATE OF description ON public.words FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', 'unexpected words triggers'],
    ['conditional timestamp trigger', 'DROP TRIGGER update_words_updated_at ON public.words; CREATE TRIGGER update_words_updated_at BEFORE UPDATE ON public.words FOR EACH ROW WHEN (OLD.description IS NOT NULL) EXECUTE FUNCTION public.update_updated_at_column()', 'unexpected words triggers'],
    ['rewrite rule', 'CREATE RULE ignore_delete AS ON DELETE TO public.words DO INSTEAD NOTHING', 'unexpected words triggers'],
    ['function name collision', 'CREATE FUNCTION public.advance_word_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$', 'already exists'],
    ['function overload collision', 'CREATE FUNCTION public.advance_word_updated_at(integer) RETURNS integer LANGUAGE sql AS $$ SELECT $1 $$', 'already exists'],
    ['inheritance', 'CREATE TABLE public.child_words () INHERITS (public.words)', 'standalone'],
    ['different owner', 'ALTER TABLE public.words OWNER TO service_role', 'postgres-owned'],
    ['disabled RLS', 'ALTER TABLE public.words DISABLE ROW LEVEL SECURITY', 'RLS-enabled'],
    ['unexpected default grants', 'CREATE ROLE r3a01_extra NOLOGIN; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO r3a01_extra', 'unexpected default function grants'],
  ];
  for (const [label, setup, message] of driftCases) {
    const target = fresh();
    sql(target, setup);
    const previous = snapshot(target, true);
    const failure = file(target, migration, true);
    assert.notEqual(failure.status, 0, `${label} must fail`);
    assert(failure.stderr.includes(message), failure.stderr);
    assert.equal(snapshot(target, true), previous, `${label}: transactional rollback`);
    pass(`drift rejected with no side effects: ${label}`);
  }
  const previous = snapshot(db, true);
  const rerun = file(db, migration, true);
  assert.notEqual(rerun.status, 0);
  assert(rerun.stderr.includes('already exists'));
  assert.equal(snapshot(db, true), previous);
  pass('accidental second application fails closed without changing installed state');

  const precision6 = fresh();
  sql(precision6, 'ALTER TABLE public.words ALTER COLUMN updated_at TYPE timestamptz(6)');
  file(precision6, migration);
  file(precision6, path.join(here, 'behavior.sql'));
  pass('explicit timestamptz(6) also passes all behavior assertions');

  const lockedDb = fresh();
  const blocker = session(lockedDb, 'BEGIN; SELECT count(*) FROM public.words;\n\\echo LOCK_READY');
  await until(() => blocker.output().includes('LOCK_READY'), 'reader transaction holds lock');
  const timeout = file(lockedDb, migration, true);
  assert.notEqual(timeout.status, 0);
  assert(timeout.stderr.includes('lock timeout'), timeout.stderr);
  blocker.child.stdin.end('ROLLBACK;\n\\q\n');
  await blocker.done;
  assert.equal(sql(lockedDb, "SELECT to_regprocedure('public.advance_word_updated_at()') IS NULL"), 't');
  pass('lock timeout aborts deployment without installing partial changes');

  const dependencyDb = fresh();
  file(dependencyDb, migration);
  sql(dependencyDb, 'CREATE TRIGGER unexpected_dependency BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.advance_word_updated_at()');
  const beforeFailedRollback = snapshot(dependencyDb, true);
  const rollbackFailure = file(dependencyDb, path.resolve(here, '../../operations/rollback_word_version.sql'), true);
  assert.notEqual(rollbackFailure.status, 0);
  assert(rollbackFailure.stderr.includes('depend'), rollbackFailure.stderr);
  assert.equal(snapshot(dependencyDb, true), beforeFailedRollback);
  pass('rollback refuses unknown dependents and restores its partial DDL transactionally');

  const beforeRollback = snapshot(db);
  file(db, path.resolve(here, '../../operations/rollback_word_version.sql'));
  assert.equal(snapshot(db), beforeRollback);
  assert.equal(sql(db, "SELECT tgfoid = 'public.update_updated_at_column()'::regprocedure FROM pg_trigger WHERE tgrelid='public.words'::regclass AND tgname='update_words_updated_at'"), 't');
  assert.equal(sql(db, "SELECT to_regprocedure('public.advance_word_updated_at()') IS NULL"), 't');
  file(db, migration);
  const recoveredVersion = sql(db, "SELECT updated_at FROM public.words WHERE id='10000000-0000-0000-0000-000000000001'");
  assert.equal(sql(db, `WITH changed AS (UPDATE public.words SET description='recovered' WHERE id='10000000-0000-0000-0000-000000000001' RETURNING updated_at) SELECT updated_at > '${recoveredVersion}'::timestamptz FROM changed`), 't');
  pass('approved rollback preserves data/other objects and allows forward recovery');
  console.log(`PASS: ${passed} integration checks (SQL assertion groups contain multiple cases).`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill();
  const stopped = !started || run('pg_ctl', ['-D', data, 'status'], true).status === 3
    || run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], true).status === 0;
  // Never recursively delete an externally supplied path or an existing cluster.
  assert(path.resolve(directory).startsWith(tempRoot + path.sep) && path.basename(directory).startsWith('r3-a01-pg-'));
  if (stopped && !process.exitCode) rmSync(directory, { recursive: true, force: true });
  else console.error(`Stopped=${stopped}; diagnostics retained at ${directory}`);
  if (!stopped) process.exitCode = 1;
}
