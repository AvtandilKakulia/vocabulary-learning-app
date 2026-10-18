import assert from 'node:assert/strict';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const missing = '00000000-0000-0000-0000-000000000099';
const word = owner => `10000000-0000-0000-0000-${owner === A ? '000000000001' : '000000000002'}`;
const history = owner => `20000000-0000-0000-0000-${owner === A ? '000000000001' : '000000000002'}`;
const freshId = '30000000-0000-0000-0000-000000000001';
const tables = ['words', 'test_history', 'profiles'];
const ownerColumn = table => table === 'profiles' ? 'id' : 'user_id';
const countMutation = sql => `WITH changed AS (${sql} RETURNING *) SELECT count(*) FROM changed`;
const insert = (table, owner, id = freshId) => table === 'words'
  ? `INSERT INTO public.words(id,user_id,english_word,georgian_definitions) VALUES ('${id}','${owner}','  New   Meaning  ','["ახალი"]')`
  : table === 'test_history'
    ? `INSERT INTO public.test_history(id,user_id,test_direction,total_words,correct_count,mistakes) VALUES ('${id}','${owner}','en-to-geo',2,1,'[{"english_word":"Yield","question_prompt":"დაზოგვა","description":"saved <b>detail</b>","correct_definitions":["დათმობა"],"user_answer":"x"}]')`
    : `INSERT INTO public.profiles(id,display_name) VALUES ('${owner}','Inserted')`;

export function verifyAuthorization({ admin, probe, clone, check, succeeded }) {
  const db = 'authorization_fixture';
  const json = (target, sql) => JSON.parse(admin(target, sql));
  const scalar = (name, context, sql, expected, target = db) => check(name, () => {
    assert.equal(succeeded(probe(target, context, sql)), expected);
  });
  const denied = (name, context, sql, state = '42501', target = db) => check(name, () => {
    const result = probe(target, context, sql);
    assert.notEqual(result.status, 0, 'Expected an error, not successful execution');
    assert.match(result.stderr, new RegExp(`ERROR:  ${state}:`), result.stderr);
  });
  const snapshot = (target, owner) => admin(target, `SELECT jsonb_build_object(
    'users', (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u ${owner ? `WHERE id='${owner}'` : ''}),
    'profiles', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.profiles p ${owner ? `WHERE id='${owner}'` : ''}),
    'words', (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.words w ${owner ? `WHERE user_id='${owner}'` : ''}),
    'history', (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.test_history h ${owner ? `WHERE user_id='${owner}'` : ''})
  )`);
  admin(db, `
    INSERT INTO auth.users(id) VALUES ('${A}'),('${B}');
    UPDATE public.profiles SET display_name=CASE id WHEN '${A}' THEN 'Private A' ELSE 'Private B' END;
    INSERT INTO public.words(id,user_id,english_word,georgian_definitions,description,part_of_speech,is_irregular_verb,past_simple,past_participle,created_at,updated_at) VALUES
      ('${word(A)}','${A}','Yield','["დათმობა"]','private A','verb',true,'yielded','yielded','2026-01-01','2026-01-01'),
      ('${word(B)}','${B}','Yield','["დათმობა"]','private B','verb',true,'yielded','yielded','2026-01-01','2026-01-01'),
      ('10000000-0000-0000-0000-000000000011','${A}','Zebra','["ზებრა"]','second A','noun',false,NULL,NULL,'2026-02-01','2026-02-01'),
      ('10000000-0000-0000-0000-000000000012','${B}','Zebra','["ზებრა"]','second B','noun',false,NULL,NULL,'2026-02-01','2026-02-01');
    ${insert('test_history', A, history(A))};
    ${insert('test_history', B, history(B))};
  `);
  const original = snapshot(db);

  // Effective privilege checks include PUBLIC, memberships and column ACLs.
  // The exact inventory also rejects unexpected public tables/views/functions.
  function verifyCatalog(target) {
    const relations = json(target, `SELECT jsonb_agg(jsonb_build_object(
      'name',relname,'kind',relkind,'owner',relowner::regrole::text,'rls',relrowsecurity,'forced',relforcerowsecurity
    ) ORDER BY relname) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m','f')`);
    assert.deepEqual(relations, [...tables].sort().map(name => ({ name, kind: 'r', owner: 'postgres', rls: true, forced: false })));
    for (const role of ['anon', 'authenticated']) {
      assert.equal(admin(target, `SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname='${role}'`), 'f');
      assert.equal(admin(target, `SELECT EXISTS(SELECT 1 FROM pg_roles WHERE (rolsuper OR rolbypassrls) AND pg_has_role('${role}',oid,'MEMBER'))`), 'f');
      for (const table of tables) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
          const expected = role === 'authenticated' && (['SELECT', 'INSERT'].includes(privilege)
            || (privilege === 'UPDATE' && table !== 'test_history') || (privilege === 'DELETE' && table !== 'profiles'));
          assert.equal(admin(target, `SELECT has_table_privilege('${role}','public.${table}','${privilege}')`), expected ? 't' : 'f', `${role} ${table} ${privilege}`);
          assert.equal(admin(target, `SELECT has_table_privilege('${role}','public.${table}','${privilege} WITH GRANT OPTION')`), 'f');
          if (['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'].includes(privilege)) {
            assert.equal(admin(target, `SELECT has_any_column_privilege('${role}','public.${table}','${privilege}')`), expected ? 't' : 'f', `column privileges: ${role} ${table} ${privilege}`);
            assert.equal(admin(target, `SELECT has_any_column_privilege('${role}','public.${table}','${privilege} WITH GRANT OPTION')`), 'f');
          }
        }
      }
      for (const schema of ['public', 'auth']) {
        assert.equal(admin(target, `SELECT has_schema_privilege('${role}','${schema}','USAGE')`), 't');
        assert.equal(admin(target, `SELECT has_schema_privilege('${role}','${schema}','CREATE')`), 'f');
      }
    }
    const functions = json(target, `SELECT jsonb_agg(jsonb_build_object('name',proname,'args',oid::regprocedure::text,
      'owner',proowner::regrole::text,'definer',prosecdef,'config',proconfig,
      'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),
      'grantable',has_function_privilege('anon',oid,'EXECUTE WITH GRANT OPTION') OR has_function_privilege('authenticated',oid,'EXECUTE WITH GRANT OPTION'),
      'public',EXISTS(SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
    ) ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace`);
    const names = ['advance_word_updated_at', 'delete_user_account', 'handle_new_user', 'search_words', 'search_words_count', 'set_english_word_norm', 'update_updated_at_column'];
    assert.deepEqual(functions.map(f => f.name), names);
    for (const f of functions) {
      assert.equal(f.owner, 'postgres');
      assert.equal(f.definer, ['delete_user_account', 'handle_new_user'].includes(f.name));
      assert.equal(f.anon, false);
      assert.equal(f.public, false);
      assert.equal(f.grantable, false);
      assert.equal(f.authenticated, ['search_words', 'search_words_count', 'delete_user_account'].includes(f.name));
      assert.deepEqual(f.config, ['set_english_word_norm', 'update_updated_at_column'].includes(f.name) ? null : ['search_path=""']);
    }
    assert.equal(functions.find(f => f.name === 'delete_user_account').args, 'delete_user_account()');
    assert.equal(functions.find(f => f.name === 'search_words').args, 'search_words(uuid,text,integer,integer,text)');
    assert.equal(functions.find(f => f.name === 'search_words_count').args, 'search_words_count(uuid,text)');
    assert.equal(admin(target, `SELECT EXISTS(SELECT 1 FROM pg_class c, LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.relname IN ('words','profiles','test_history') AND c.relnamespace='public'::regnamespace AND a.grantee=0)`), 'f');
    const policies = json(target, `SELECT jsonb_agg(jsonb_build_object('table',polrelid::regclass::text,'cmd',polcmd,
      'permissive',polpermissive,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))
      ORDER BY polrelid::regclass::text,polcmd) FROM pg_policy WHERE polrelid IN ('public.words'::regclass,'public.profiles'::regclass,'public.test_history'::regclass)`);
    assert.equal(policies.length, 10);
    for (const p of policies) {
      assert.equal(p.permissive, true);
      assert(['a', 'r', 'w', 'd'].includes(p.cmd));
      assert.equal(p.using, p.cmd === 'a' ? null : `(auth.uid() = ${ownerColumn(p.table)})`);
      assert.equal(p.check, ['a', 'w'].includes(p.cmd)
        ? p.table === 'words' && p.cmd === 'a' ? '((auth.uid() IS NOT NULL) AND (auth.uid() = user_id))' : `(auth.uid() = ${ownerColumn(p.table)})`
        : null);
    }
    const foreignKeys = json(target, `SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'target',confrelid::regclass::text,
      'valid',convalidated,'delete',confdeltype,'deferrable',condeferrable,'sql',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text)
      FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`);
    assert.deepEqual(foreignKeys, [...tables].sort().map(table => ({ table, target: 'auth.users', valid: true, delete: 'c', deferrable: false,
      sql: `FOREIGN KEY (${ownerColumn(table)}) REFERENCES auth.users(id) ON DELETE CASCADE` })));
    const triggers = json(target, `SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled,p.proname) ORDER BY tgname)
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND tgrelid IN ('public.words'::regclass,'public.profiles'::regclass,'auth.users'::regclass)`);
    assert.deepEqual(triggers, [['on_auth_user_created','O','handle_new_user'],['trg_set_english_word_norm','O','set_english_word_norm'],
      ['update_profiles_updated_at','O','update_updated_at_column'],['update_words_updated_at','O','advance_word_updated_at']]);
  }
  check('catalog: RLS, ten policies, effective/PUBLIC/column/inherited grants, owners, RPC inventory, search_path, FKs and triggers', () => verifyCatalog(db));

  for (const [owner, other, label] of [[A, B, 'A'], [B, A, 'B']]) {
    const ctx = { sub: owner };
    scalar(`${label}: real gateway session and JWT subject`, ctx, `SELECT session_user || ':' || current_user || ':' || auth.uid()`, `authorization_gateway:authenticated:${owner}`);
    scalar(`${label}: legacy JWT subject also isolates words`, { sub: owner, legacy: true }, `SELECT bool_and(user_id='${owner}') AND count(*)=2 FROM public.words`, 't');
    for (const table of tables) {
      const col = ownerColumn(table);
      scalar(`${label}: ${table} unfiltered SELECT exposes only own complete rows`, ctx,
        `SELECT bool_and(${col}='${owner}') AND count(*)=${table === 'words' ? 2 : 1} FROM public.${table}`, 't');
      scalar(`${label}: ${table} explicit other owner SELECT is empty`, ctx, `SELECT count(*) FROM public.${table} WHERE ${col}='${other}'`, '0');
      denied(`${label}: ${table} cross-owner INSERT`, ctx, insert(table, other));
      denied(`${label}: ${table} NULL owner INSERT`, ctx, insert(table, owner).replace(`'${owner}'`, 'NULL'));
      const payload = table === 'words' ? "description='attack'" : table === 'profiles' ? "display_name='attack'" : 'correct_count=0';
      if (table === 'test_history') {
        denied(`${label}: History UPDATE own or other is not granted`, ctx, `UPDATE public.${table} SET ${payload}`);
        denied(`${label}: History owner reassignment is not granted`, ctx, `UPDATE public.${table} SET user_id='${other}' WHERE user_id='${owner}'`);
      } else {
        scalar(`${label}: ${table} cross-owner UPDATE affects zero rows`, ctx, countMutation(`UPDATE public.${table} SET ${payload} WHERE ${col}='${other}'`), '0');
        denied(`${label}: ${table} own row cannot be transferred to other owner`, ctx, `UPDATE public.${table} SET ${col}='${other}' WHERE ${col}='${owner}'`);
        scalar(`${label}: ${table} unfiltered UPDATE affects only own rows`, ctx, countMutation(`UPDATE public.${table} SET ${payload}`), table === 'words' ? '2' : '1');
      }
      if (table === 'profiles') denied(`${label}: profile DELETE is not granted`, ctx, 'DELETE FROM public.profiles');
      else {
        scalar(`${label}: ${table} cross-owner DELETE affects zero rows`, ctx, countMutation(`DELETE FROM public.${table} WHERE user_id='${other}'`), '0');
        scalar(`${label}: ${table} unfiltered DELETE returns only own IDs`, ctx,
          `WITH removed AS (DELETE FROM public.${table} RETURNING *) SELECT bool_and(user_id='${owner}') AND count(*)=${table === 'words' ? 2 : 1} FROM removed`, 't');
        scalar(`${label}: ${table} own INSERT works`, ctx, countMutation(insert(table, owner)), '1');
      }
      denied(`${label}: ${table} TRUNCATE cannot bypass RLS`, ctx, `TRUNCATE public.${table} CASCADE`);
    }
    scalar(`${label}: profile upsert existing row works`, ctx,
      countMutation(`${insert('profiles', owner)} ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name`), '1');
    denied(`${label}: profile upsert other owner rejected`, ctx,
      `${insert('profiles', other)} ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name`);
    denied(`${label}: Word upsert cannot take over another ID`, ctx,
      `${insert('words', owner, word(other))} ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,english_word=EXCLUDED.english_word`);
    denied(`${label}: immutable History upsert has no UPDATE privilege`, ctx,
      `${insert('test_history', owner, history(owner))} ON CONFLICT(id) DO UPDATE SET correct_count=EXCLUDED.correct_count`);
    scalar(`${label}: normalization and independent meanings`, ctx, `WITH added AS (${insert('words', owner)} RETURNING english_word_norm)
      SELECT english_word_norm FROM added`, 'new meaning');
    scalar(`${label}: repeated spelling allowed for own account`, ctx,
      countMutation(`INSERT INTO public.words(user_id,english_word) VALUES ('${owner}','Yield'),('${owner}',' yield ')`), '2');
    scalar(`${label}: word UPDATE preserves grammar and advances version`, ctx,
      `WITH changed AS (UPDATE public.words SET description='changed',english_word=' YIELD  ' WHERE id='${word(owner)}' AND updated_at='2026-01-01' RETURNING *)
      SELECT english_word_norm='yield' AND part_of_speech='verb' AND is_irregular_verb AND past_simple='yielded' AND past_participle='yielded'
        AND georgian_definitions='["დათმობა"]'::jsonb AND updated_at>'2026-01-01' FROM changed`, 't');
    scalar(`${label}: stale version predicate rejects own overwrite`, ctx,
      countMutation(`UPDATE public.words SET description='stale' WHERE id='${word(owner)}' AND user_id='${owner}' AND updated_at='2000-01-01'`), '0');
    denied(`${label}: conflicting History ID cannot overwrite other result (PK existence signal)`, ctx, insert('test_history', owner, history(other)), '23505');
    scalar(`${label}: conflict recovery SELECT cannot expose other History payload`, ctx, `SELECT count(*) FROM public.test_history WHERE id='${history(other)}'`, '0');
    scalar(`${label}: mixed confirmed History IDs delete only own ID`, ctx,
      `WITH removed AS (DELETE FROM public.test_history WHERE id IN ('${history(owner)}','${history(other)}') RETURNING id) SELECT id FROM removed`, history(owner));
    for (const mode of ['alpha-asc', 'alpha-desc', 'recent', 'unsupported']) {
      scalar(`${label}: Search ${mode} other account argument cannot override RLS`, ctx,
        `SELECT count(*) FROM public.search_words('${other}','',0,100,'${mode}')`, '0');
      scalar(`${label}: Search ${mode} own full rows and globally sorted page`, ctx,
        `SELECT english_word FROM public.search_words('${owner}','',0,1,'${mode}')`, ['alpha-desc', 'recent'].includes(mode) ? 'Zebra' : 'Yield');
    }
    scalar(`${label}: Search complete Word matches direct row exactly`, ctx,
      `SELECT to_jsonb(s)=to_jsonb(w) FROM public.search_words('${owner}','დათმობა',0,100) s JOIN public.words w USING(id)`, 't');
    scalar(`${label}: Search count own dictionary`, ctx, `SELECT public.search_words_count('${owner}','')`, '2');
    scalar(`${label}: Search count other dictionary`, ctx, `SELECT public.search_words_count('${other}','')`, '0');
    scalar(`${label}: user_metadata cannot grant other ownership`, { sub: owner, claims: { user_metadata: { sub: other, user_id: other, role: 'service_role' } } },
      `SELECT count(*) FROM public.words WHERE user_id='${other}'`, '0');
  }

  for (const table of tables) {
    const col = ownerColumn(table);
    const payload = table === 'profiles' ? "display_name='x'" : table === 'words' ? "description='x'" : 'correct_count=0';
    for (const sub of [null, A]) {
      const anon = { role: 'anon', sub };
      for (const [operation, sql] of [['SELECT', `SELECT * FROM public.${table}`], ['INSERT', insert(table, A)],
        ['UPDATE', `UPDATE public.${table} SET ${payload} WHERE ${col}='${A}'`], ['DELETE', `DELETE FROM public.${table} WHERE ${col}='${A}'`]]) {
        denied(`anon ${sub ? 'with forged subject' : 'without subject'}: ${table} ${operation} denied`, anon, sql);
      }
    }
    scalar(`authenticated without subject: ${table} reads empty`, {}, `SELECT count(*) FROM public.${table}`, '0');
    denied(`authenticated without subject: ${table} INSERT denied`, {}, insert(table, A));
    if (table !== 'test_history') scalar(`authenticated without subject: ${table} UPDATE zero`, {}, countMutation(`UPDATE public.${table} SET ${payload}`), '0');
    if (table !== 'profiles') scalar(`authenticated without subject: ${table} DELETE zero`, {}, countMutation(`DELETE FROM public.${table}`), '0');
    scalar(`unknown subject: ${table} reads empty`, { sub: missing }, `SELECT count(*) FROM public.${table}`, '0');
    denied(`unknown subject: ${table} own INSERT fails auth FK`, { sub: missing }, insert(table, missing), '23503');
    denied(`malformed subject: ${table} fails closed`, { sub: 'not-a-uuid' }, `SELECT * FROM public.${table}`, '22P02');
  }
  for (const sql of [`SELECT * FROM public.search_words('${A}','',0,100)`, `SELECT public.search_words_count('${A}','')`, 'SELECT public.delete_user_account()']) {
    denied(`anon: RPC EXECUTE denied: ${sql}`, { role: 'anon' }, sql);
    denied(`anon with subject: RPC EXECUTE denied: ${sql}`, { role: 'anon', sub: A }, sql);
  }
  scalar('no subject: Search returns no rows', {}, `SELECT count(*) FROM public.search_words('${A}','',0,100)`, '0');
  scalar('no subject: Search count returns zero', {}, `SELECT public.search_words_count('${A}','')`, '0');
  denied('no subject: delete account explicitly requires authentication', {}, 'SELECT public.delete_user_account()');
  denied('malformed subject: account deletion fails closed', { sub: 'not-a-uuid' }, 'SELECT public.delete_user_account()', '22P02');
  denied('no account deletion overload accepts a victim ID', { sub: A }, `SELECT public.delete_user_account('${B}'::uuid)`, '42883');
  for (const name of ['handle_new_user', 'set_english_word_norm', 'update_updated_at_column', 'advance_word_updated_at']) {
    for (const role of ['anon', 'authenticated']) denied(`${role}: internal trigger RPC ${name} not exposed`, { role, sub: A }, `SELECT public.${name}()`);
  }
  for (const sql of ['SET ROLE postgres', 'SET ROLE service_role', 'SET SESSION AUTHORIZATION postgres',
    'ALTER TABLE public.words DISABLE ROW LEVEL SECURITY', 'ALTER TABLE public.words DISABLE TRIGGER ALL',
    'CREATE TABLE public.attacker(id integer)', 'CREATE TABLE auth.attacker(id integer)',
    'SELECT * FROM auth.users', `DELETE FROM auth.users WHERE id='${B}'`,
    'CREATE OR REPLACE FUNCTION public.delete_user_account() RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$']) {
    denied(`authenticated cannot escalate: ${sql}`, { sub: A }, sql);
  }
  check('unprivileged GRANT warns but cannot confer any rights', () => {
    const acl = admin(db, "SELECT relacl::text FROM pg_class WHERE oid='public.words'::regclass");
    const result = probe(db, { sub: A }, "GRANT ALL ON public.words TO anon; SELECT has_table_privilege('anon','public.words','SELECT')", true);
    assert.equal(succeeded(result), 'f');
    assert.match(result.stderr, /no privileges were granted/);
    assert.equal(admin(db, "SELECT relacl::text FROM pg_class WHERE oid='public.words'::regclass"), acl);
  });
  // RLS off is an error, not a way for an ordinary SQL caller to bypass policy.
  denied('row_security=off cannot bypass words RLS', { sub: A }, 'SET LOCAL row_security=off; SELECT * FROM public.words');

  check('all denied/rolled-back probes leave exact A and B rows unchanged', () => assert.equal(snapshot(db), original));
  const profileDb = clone();
  admin(profileDb, `DELETE FROM public.profiles WHERE id='${A}'`);
  check('missing own profile INSERT succeeds and preserves B exactly', () => {
    const bBefore = snapshot(profileDb, B);
    assert.equal(succeeded(probe(profileDb, { sub: A }, countMutation(insert('profiles', A)), true)), '1');
    assert.equal(admin(profileDb, `SELECT display_name FROM public.profiles WHERE id='${A}'`), 'Inserted');
    assert.equal(snapshot(profileDb, B), bBefore);
  });

  for (const [owner, other] of [[A, B], [B, A]]) {
    const target = clone();
    check(`committed account deletion ${owner}: only caller auth/profile/words/history removed`, () => {
      const beforeOther = snapshot(target, other);
      succeeded(probe(target, { sub: owner }, `
        CREATE TEMP TABLE words (id uuid); CREATE TEMP TABLE profiles (id uuid); CREATE TEMP TABLE test_history (id uuid);
        SET LOCAL search_path=pg_temp,public,auth;
        SELECT public.delete_user_account()
      `, true));
      assert.deepEqual(JSON.parse(snapshot(target, owner)), { users: null, profiles: null, words: null, history: null });
      assert.equal(snapshot(target, other), beforeOther, 'Other account exact rows/timestamps/JSON unchanged');
      // Deleting auth.users is not cryptographic token revocation. Even a retained
      // old subject must have no rows and cannot insert or recreate its profile.
      for (const table of tables) {
        assert.equal(succeeded(probe(target, { sub: owner }, `SELECT count(*) FROM public.${table}`)), '0');
        const result = probe(target, { sub: owner }, insert(table, owner));
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /ERROR:  23503:/);
      }
      succeeded(probe(target, { sub: owner }, 'SELECT public.delete_user_account()', true));
      assert.equal(snapshot(target, other), beforeOther);
    });
  }

  // Negative controls are committed ONLY in throwaway clones, never the fixture.
  // They prove assertions detect actual bad policies/ACLs and RPC escalation.
  for (const [label, sql] of [
    ['PUBLIC table grant', 'GRANT SELECT ON public.words TO PUBLIC'],
    ['inherited forbidden table grant', 'CREATE ROLE authorization_extra NOLOGIN; GRANT UPDATE ON public.test_history TO authorization_extra; GRANT authorization_extra TO authenticated'],
    ['column-only privilege', 'GRANT SELECT(description) ON public.words TO anon'],
    ['grant option', 'GRANT SELECT ON public.words TO authenticated WITH GRANT OPTION'],
    ['unexpected PUBLIC function execute', 'GRANT EXECUTE ON FUNCTION public.delete_user_account() TO PUBLIC'],
    ['inherited forbidden function execute', 'CREATE ROLE authorization_function_extra NOLOGIN; GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authorization_function_extra; GRANT authorization_function_extra TO authenticated'],
    ['RLS disabled', 'ALTER TABLE public.words DISABLE ROW LEVEL SECURITY'],
    ['permissive policy broadening', 'CREATE POLICY leaked_read ON public.words FOR SELECT TO authenticated USING(true)'],
    ['definer Search bypass', 'ALTER FUNCTION public.search_words(uuid,text,integer,integer,text) SECURITY DEFINER'],
  ]) {
    const target = clone();
    admin(target, sql);
    check(`negative control detects ${label}`, () => {
      assert.throws(() => verifyCatalog(target), assert.AssertionError);
      if (label === 'permissive policy broadening' || label === 'RLS disabled') {
        assert.equal(succeeded(probe(target, { sub: A }, `SELECT count(*) FROM public.words WHERE user_id='${B}'`)), '2');
      }
      if (label === 'definer Search bypass') {
        assert.equal(succeeded(probe(target, { sub: A }, `SELECT count(*) FROM public.search_words('${B}','',0,100)`)), '2');
      }
    });
  }
}
