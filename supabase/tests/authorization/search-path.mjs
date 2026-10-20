import assert from 'node:assert/strict';

// Extends the existing complete-migration-chain assertion group. All databases
// are clones inside authorization/run.mjs's fresh loopback-only cluster.
export function verifySearchPathMigration({ admin, file, probe, migration }) {
  const base = 'search_path_before';
  const owner = '00000000-0000-0000-0000-000000000001';
  const names = ['set_english_word_norm', 'update_updated_at_column'];
  admin('postgres', `CREATE DATABASE ${base} TEMPLATE authorization_fixture`);
  admin(base, `
    INSERT INTO auth.users VALUES ('${owner}'), ('00000000-0000-0000-0000-000000000002');
    INSERT INTO public.words(user_id,english_word,description) VALUES
      ('${owner}','Original','Keep this record'),
      ('00000000-0000-0000-0000-000000000002','Other','Keep other account');
    INSERT INTO public.test_history(user_id,test_direction,total_words,correct_count,mistakes)
      VALUES ('${owner}','en-to-geo',1,0,'[{"description":"Saved mistake"}]');
  `);
  let sequence = 0;
  const clone = () => {
    const db = `search_path_case_${++sequence}`;
    admin('postgres', `CREATE DATABASE ${db} TEMPLATE ${base}`);
    return db;
  };
  const snapshot = db => JSON.parse(admin(db, `SELECT jsonb_build_object(
    'users', (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u),
    'words', (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.words w),
    'profiles', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.profiles p),
    'history', (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.test_history h),
    'tables', (SELECT jsonb_agg(jsonb_build_array(oid,relname,relkind,relowner,relacl,relrowsecurity,relforcerowsecurity,reloptions) ORDER BY oid)
      FROM pg_class WHERE relnamespace='public'::regnamespace),
    'columns', (SELECT jsonb_agg(to_jsonb(a) ORDER BY attrelid,attnum) FROM pg_attribute a
      WHERE attrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)),
    'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p),
    'constraints', (SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c WHERE connamespace='public'::regnamespace),
    'indexes', (SELECT jsonb_agg(to_jsonb(i) ORDER BY indexname) FROM pg_indexes i WHERE schemaname='public'),
    'functions', (SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='public'::regnamespace),
    'triggers', (SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t),
    'dependencies', (SELECT jsonb_agg(to_jsonb(d) ORDER BY classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype) FROM pg_depend d),
    'sharedDependencies', (SELECT jsonb_agg(to_jsonb(d) ORDER BY classid,objid,objsubid,refclassid,refobjid,deptype) FROM pg_shdepend d
      WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()))
  )`));
  const behavior = (db, callerPath, timezone = 'UTC') => {
    const result = probe(db, { sub: owner }, `
      SET LOCAL search_path = ${callerPath};
      SET LOCAL timezone = '${timezone}';
      INSERT INTO public.words(user_id,english_word) VALUES
        ('${owner}','Yield'),('${owner}','yield'),('${owner}',E' \\tYiELD   Now\\n '),
        ('${owner}',E' \\t\\n '),('${owner}',' ქართული  სიტყვა ');
      UPDATE public.words SET english_word=E' \\tUPDATE   Me\\n ' WHERE english_word='Original';
      DO $behavior$
      DECLARE first_stamp timestamptz; second_stamp timestamptz;
      BEGIN
        UPDATE public.profiles SET display_name='first',updated_at='1900-01-01' WHERE id='${owner}'
          RETURNING updated_at INTO first_stamp;
        UPDATE public.profiles SET display_name='second',updated_at='1901-01-01' WHERE id='${owner}'
          RETURNING updated_at INTO second_stamp;
        IF first_stamp IS DISTINCT FROM pg_catalog.timezone('utc',pg_catalog.now())::timestamptz
          OR second_stamp IS DISTINCT FROM first_stamp THEN
          RAISE EXCEPTION 'profile transaction-start timestamp behavior changed';
        END IF;
      END;
      $behavior$;
      SELECT jsonb_build_object(
        'normalized', (SELECT jsonb_agg(english_word_norm ORDER BY english_word_norm) FROM public.words WHERE user_id='${owner}'),
        'path', current_setting('search_path')
      )
    `);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.normalized, ['', 'update me', 'yield', 'yield', 'yield now', 'ქართული სიტყვა']);
    return output;
  };
  const target = clone();
  const paths = ['"$user", public', 'pg_temp, public, auth', "''", 'public, pg_catalog'];
  const beforeBehavior = paths.map(p => behavior(target, p));
  const beforeTbilisi = behavior(target, 'pg_temp, public', 'Asia/Tbilisi');
  const before = snapshot(target);
  const expected = structuredClone(before);
  for (const f of expected.functions.filter(f => names.includes(f.proname))) {
    assert.equal(f.proconfig, null);
    f.proconfig = ['search_path=""'];
  }
  file(target, migration);
  assert.deepEqual(snapshot(target), expected, 'Only the two proconfig values may change, including original OIDs/dependencies');
  assert.deepEqual(paths.map(p => behavior(target, p)), beforeBehavior, 'Same normalization/profile behavior and restored caller paths');
  assert.deepEqual(behavior(target, 'pg_temp, public', 'Asia/Tbilisi'), beforeTbilisi);
  assert.deepEqual(snapshot(target), expected, 'Rolled-back behavior probes must not change stored data');
  console.log('  R4-SEC-04: only two configurations changed; data, OIDs, bodies, ACLs, bindings and behavior preserved');

  // A schema ahead of explicit pg_catalog can shadow built-ins in the legacy
  // normalization body. No application role is granted CREATE or direct RPC.
  const shadow = clone();
  admin(shadow, `
    CREATE SCHEMA caller_shadow;
    GRANT USAGE ON SCHEMA caller_shadow TO authenticated;
    CREATE FUNCTION caller_shadow.regexp_replace(text,text,text,text) RETURNS text LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'shadow builtin invoked'; END $$;
    CREATE FUNCTION caller_shadow.lower(text) RETURNS text LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'shadow builtin invoked'; END $$;
    CREATE FUNCTION caller_shadow.btrim(text) RETURNS text LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'shadow builtin invoked'; END $$;
    CREATE FUNCTION caller_shadow.now() RETURNS timestamptz LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'shadow builtin invoked'; END $$;
  `);
  assert.throws(() => behavior(shadow, 'caller_shadow, pg_catalog, public'), /shadow builtin invoked/);
  file(shadow, migration);
  const hardened = behavior(shadow, 'caller_shadow, pg_catalog, public');
  assert.equal(hardened.path, 'caller_shadow, pg_catalog, public', 'Function-local path does not leak to caller');
  console.log('  R4-SEC-04: hostile caller search_path reproduces legacy shadowing and cannot affect hardened triggers');

  const drifts = [
    ['missing function', 'DROP TRIGGER trg_set_english_word_norm ON public.words; DROP FUNCTION public.set_english_word_norm()', 'missing function'],
    ['overload', 'CREATE FUNCTION public.set_english_word_norm(integer) RETURNS integer LANGUAGE sql AS $$ SELECT $1 $$', 'unexpected overload'],
    ['normalizer owner', 'ALTER FUNCTION public.set_english_word_norm() OWNER TO service_role', 'postgres-owned'],
    ['profile owner', 'ALTER FUNCTION public.update_updated_at_column() OWNER TO service_role', 'postgres-owned'],
    ['normalizer definer', 'ALTER FUNCTION public.set_english_word_norm() SECURITY DEFINER', 'SECURITY INVOKER'],
    ['profile definer', 'ALTER FUNCTION public.update_updated_at_column() SECURITY DEFINER', 'SECURITY INVOKER'],
    ['normalizer path drift', "ALTER FUNCTION public.set_english_word_norm() SET search_path = public", 'NULL configuration'],
    ['profile configuration drift', "ALTER FUNCTION public.update_updated_at_column() SET statement_timeout = '1s'", 'NULL configuration'],
    ['partial prior hardening', "ALTER FUNCTION public.update_updated_at_column() SET search_path = ''", 'NULL configuration'],
    ['PUBLIC execute', 'GRANT EXECUTE ON FUNCTION public.set_english_word_norm() TO PUBLIC', 'EXECUTE'],
    ['authenticated execute', 'GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated', 'EXECUTE'],
    ['anon execute', 'GRANT EXECUTE ON FUNCTION public.set_english_word_norm() TO anon', 'EXECUTE'],
    ['normalizer disabled', 'ALTER TABLE public.words DISABLE TRIGGER trg_set_english_word_norm', 'trigger bindings'],
    ['profile replica trigger', 'ALTER TABLE public.profiles ENABLE REPLICA TRIGGER update_profiles_updated_at', 'trigger bindings'],
    ['profile missing trigger', 'DROP TRIGGER update_profiles_updated_at ON public.profiles', 'trigger bindings'],
    ['normalizer conditional', `DROP TRIGGER trg_set_english_word_norm ON public.words;
      CREATE TRIGGER trg_set_english_word_norm BEFORE INSERT OR UPDATE OF english_word ON public.words
      FOR EACH ROW WHEN (NEW.description IS NOT NULL) EXECUTE FUNCTION public.set_english_word_norm()`, 'trigger bindings'],
    ['profile redirected', `DROP TRIGGER update_profiles_updated_at ON public.profiles;
      CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.advance_word_updated_at()`, 'trigger bindings'],
    ['unexpected extra binding', `CREATE TRIGGER extra_timestamp BEFORE UPDATE ON public.words
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`, 'trigger bindings'],
  ];
  for (const [label, setup, error] of drifts) {
    const db = clone();
    admin(db, setup);
    const prior = snapshot(db);
    assert.throws(() => file(db, migration), new RegExp(error), label);
    assert.deepEqual(snapshot(db), prior, `${label}: failure must leave all data/catalog state unchanged`);
    console.log(`  R4-SEC-04: fail-closed preflight: ${label}`);
  }
  assert.throws(() => file(target, migration), /NULL configuration/, 'Rerun must not overwrite installed configuration');
  assert.deepEqual(snapshot(target), expected);

  // Force failure on the second ALTER to prove the first ALTER is rolled back.
  const atomic = clone();
  admin(atomic, `
    CREATE SCHEMA test_hooks;
    CREATE FUNCTION test_hooks.reject_second_alter() RETURNS event_trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='public.update_updated_at_column()') THEN
        RAISE EXCEPTION 'injected second ALTER failure';
      END IF;
    END $$;
    CREATE EVENT TRIGGER reject_second_alter ON ddl_command_end WHEN TAG IN ('ALTER FUNCTION')
      EXECUTE FUNCTION test_hooks.reject_second_alter();
  `);
  const atomicBefore = snapshot(atomic);
  assert.throws(() => file(atomic, migration), /injected second ALTER failure/);
  assert.deepEqual(snapshot(atomic), atomicBefore, 'Second ALTER failure rolls back the first configuration change');

  // Exercise the documented, separately approved incident rollback in a clone.
  admin(target, `BEGIN;
    ALTER FUNCTION public.set_english_word_norm() RESET search_path;
    ALTER FUNCTION public.update_updated_at_column() RESET search_path;
    COMMIT;`);
  assert.deepEqual(snapshot(target), before, 'Rollback restores original NULL configs without any other change');
  file(target, migration);
  assert.deepEqual(snapshot(target), expected, 'Forward recovery after rollback');
  console.log(`  R4-SEC-04: ${drifts.length} drift cases, rerun rejection, atomic failure, rollback and forward recovery passed`);
}
