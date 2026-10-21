// No connection URL/host/database argument is accepted. Only a NEW local cluster
// can be tested. Uses the established word-version runner's isolation approach.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAuthorization } from './cases.mjs';
import { verifySearchPathMigration } from './search-path.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--pg-bin' && args[1]),
  'Usage: node supabase/tests/authorization/run.mjs [--pg-bin /path/to/bin]');
const bin = args[1] ?? '';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PG')));
env.PGTZ = 'UTC';
env.PGCLIENTENCODING = 'UTF8';
const executable = name => bin ? path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
function run(name, argv, input) {
  const result = spawnSync(executable(name), argv, {
    env, input, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    ...(name === 'pg_ctl' && argv.includes('start') ? { stdio: 'ignore' } : {}),
  });
  if (result.error) throw result.error;
  return result;
}
function succeeded(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return (result.stdout ?? '').trim();
}
for (const name of ['initdb', 'pg_ctl', 'psql']) succeeded(run(name, ['--version']));
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const root = path.resolve(os.tmpdir());
const directory = mkdtempSync(path.join(root, 'r4-sec-01-pg-'));
const data = path.join(directory, 'data');
const psqlArgs = (db, user) => ['-X', '-w', '-h', '127.0.0.1', '-p', String(port), '-U', user,
  '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'];
const admin = (db, sql) => succeeded(run('psql', [...psqlArgs(db, 'postgres'), '-f', '-'], sql));
const file = (db, name) => succeeded(run('psql', [...psqlArgs(db, 'postgres'), '-f', name]));
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
let passed = 0;
const check = (name, callback) => { callback(); console.log(`PASS ${++passed}: ${name}`); };
let started = false;
try {
  succeeded(run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']));
  appendFileSync(path.join(data, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\ntimezone = 'UTC'\n`);
  started = true;
  succeeded(run('pg_ctl', ['-D', data, '-l', path.join(directory, 'server.log'), '-w', '-t', '20', 'start']));
  console.log(admin('postgres', 'SELECT version()'));
  console.log(`Disposable cluster: ${directory}; 127.0.0.1:${port}`);
  admin('postgres', 'CREATE DATABASE authorization_fixture');
  file('authorization_fixture', path.join(here, 'fixture.sql'));
  const migrations = path.resolve(here, '../../migrations');
  check('complete migration chain, no fabricated Supabase migration ledger', () => {
    for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
      const filename = path.join(migrations, name);
      if (name === '20261020175702_harden_trigger_function_search_paths.sql') {
        verifySearchPathMigration({ admin, file, probe, migration: filename });
      }
      file('authorization_fixture', filename);
      console.log(`MIGRATION ${name} sha256=${createHash('sha256').update(readFileSync(filename)).digest('hex')}`);
    }
    assert.equal(admin('authorization_fixture', "SELECT count(*) FROM pg_namespace WHERE nspname='supabase_migrations'"), '0');
  });

  // Every application probe connects as the unprivileged gateway. No RESET ROLE
  // or role switch back to an administrator is possible inside these sessions.
  function probe(db, { role = 'authenticated', sub = null, legacy = false, claims = {} } = {}, sql, commit = false) {
    assert(['anon', 'authenticated'].includes(role));
    const jwt = { ...claims, role, ...(sub === null ? {} : { sub }) };
    return run('psql', [...psqlArgs(db, 'authorization_gateway'), '-f', '-'], `
      BEGIN;
      SET LOCAL statement_timeout = '5s';
      SET LOCAL ROLE ${role};
      SET LOCAL request.jwt.claim.sub = ${literal(legacy ? sub ?? '' : '')};
      SET LOCAL request.jwt.claims = ${literal(JSON.stringify(legacy ? { role } : jwt))};
      DO $guard$ BEGIN
        IF session_user <> 'authorization_gateway' OR current_user <> ${literal(role)} OR EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname IN (session_user, current_user) AND (rolsuper OR rolbypassrls)
        ) THEN RAISE EXCEPTION 'Application probe used a privileged identity'; END IF;
      END $guard$;
      ${sql};
      ${commit ? 'COMMIT' : 'ROLLBACK'};
    `);
  }
  let sequence = 0;
  const clone = () => {
    const db = `authorization_case_${++sequence}`;
    admin('postgres', `CREATE DATABASE ${db} TEMPLATE authorization_fixture`);
    return db;
  };
  check('owner-approved metadata script executes read-only on the isolated fixture', () => {
    file('authorization_fixture', path.join(here, 'production-metadata-readonly.sql'));
  });
  verifyAuthorization({ admin, probe, clone, check, succeeded });
  console.log(`PASS: ${passed} authorization checks; all application probes used non-bypassing roles.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  const stopped = !started || run('pg_ctl', ['-D', data, 'status']).status === 3
    || run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']).status === 0;
  assert(path.resolve(directory).startsWith(root + path.sep) && path.basename(directory).startsWith('r4-sec-01-pg-'));
  if (stopped && !process.exitCode) rmSync(directory, { recursive: true, force: true });
  else console.error(`Stopped=${stopped}; diagnostic files retained: ${directory}`);
  if (!stopped) process.exitCode = 1;
}
