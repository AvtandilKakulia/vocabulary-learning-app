-- NOT executed against Production by this task. Owner review/explicit target
-- approval is required before using this file on any hosted database.
-- Metadata only: no application rows, JWTs, passwords or RPC execution.
-- Run with a client that stops on errors; disconnect/ROLLBACK on any failure.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog;

SELECT current_database(), current_user, version(),
  current_setting('server_version_num') AS server_version_num,
  current_setting('row_security') AS row_security;

SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname IN ('postgres','authenticator','anon','authenticated','service_role');
SELECT member.rolname AS member, granted.rolname AS granted_role, m.admin_option
FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles granted ON granted.oid=m.roleid
ORDER BY member.rolname, granted.rolname;
-- Membership closure catches indirect/inherited and SET ROLE paths. Inspect
-- both attributes and graph; a raw explicit ACL alone does not prove isolation.
SELECT app.rolname AS application_role, parent.rolname AS parent_role,
  pg_has_role(app.oid,parent.oid,'USAGE') AS inherited_now,
  pg_has_role(app.oid,parent.oid,'SET') AS can_set_role, parent.rolsuper, parent.rolbypassrls
FROM pg_roles app CROSS JOIN pg_roles parent
WHERE app.rolname IN ('anon','authenticated') AND pg_has_role(app.oid,parent.oid,'MEMBER');

SELECT nspname, nspowner::regrole AS owner, nspacl
FROM pg_namespace WHERE nspname IN ('public','auth');
SELECT r.rolname,n.nspname,has_schema_privilege(r.oid,n.oid,'USAGE') AS usage,
  has_schema_privilege(r.oid,n.oid,'CREATE') AS create_objects
FROM pg_roles r CROSS JOIN pg_namespace n
WHERE r.rolname IN ('anon','authenticated') AND n.nspname IN ('public','auth');

-- Include unexpected public views/tables, not just the three known tables.
SELECT c.oid::regclass AS object,c.relkind,c.relowner::regrole AS owner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions
FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname;
SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT r.rolname,c.oid::regclass AS object,p.privilege,
  has_table_privilege(r.oid,c.oid,p.privilege) AS effective,
  has_table_privilege(r.oid,c.oid,p.privilege || ' WITH GRANT OPTION') AS grantable
FROM pg_roles r CROSS JOIN pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(privilege)
WHERE r.rolname IN ('anon','authenticated') AND c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
ORDER BY c.relname,r.rolname,p.privilege;
SELECT r.rolname,c.oid::regclass AS object,a.attname,p.privilege,
  has_column_privilege(r.oid,c.oid,a.attnum,p.privilege) AS effective,a.attacl
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege)
WHERE r.rolname IN ('anon','authenticated') AND c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname,a.attnum,r.rolname,p.privilege;
SELECT c.oid::regclass AS object,a.grantee,a.grantor::regrole,a.privilege_type,a.is_grantable
FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','f');

SELECT p.oid::regprocedure AS function,p.proowner::regrole AS owner,p.prosecdef,p.proacl,p.proconfig,
  pg_get_function_result(p.oid) AS returns,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p WHERE p.prokind IN ('f','p') AND (p.pronamespace='public'::regnamespace OR p.oid=to_regprocedure('auth.uid()'))
ORDER BY p.oid::regprocedure::text;
SELECT r.rolname,p.oid::regprocedure AS function,has_function_privilege(r.oid,p.oid,'EXECUTE') AS effective_execute,
  has_function_privilege(r.oid,p.oid,'EXECUTE WITH GRANT OPTION') AS grantable
FROM pg_roles r CROSS JOIN pg_proc p
WHERE r.rolname IN ('anon','authenticated') AND p.pronamespace='public'::regnamespace;
SELECT p.oid::regprocedure AS function,a.grantee,a.grantor::regrole,a.privilege_type,a.is_grantable
FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
WHERE p.pronamespace='public'::regnamespace;
SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl FROM pg_default_acl;

SELECT conrelid::regclass AS object,conname,contype,convalidated,pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid::regclass::text,conname;
SELECT tgrelid::regclass AS object,tgname,tgenabled,tgfoid::regprocedure,pg_get_triggerdef(oid) AS definition
FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (to_regclass('public.words'),to_regclass('public.profiles'),to_regclass('public.test_history'),to_regclass('auth.users'));
SELECT attrelid::regclass AS object,attname,format_type(atttypid,atttypmod) AS type,atttypmod,attnotnull,attgenerated
FROM pg_attribute WHERE attrelid IN (to_regclass('public.words'),to_regclass('public.profiles'),to_regclass('public.test_history')) AND attnum>0 AND NOT attisdropped;
SELECT ev_class::regclass AS object,rulename,pg_get_ruledef(oid) FROM pg_rewrite WHERE ev_class IN (
  to_regclass('public.words'),to_regclass('public.profiles'),to_regclass('public.test_history'));

-- Presence is evidence only; do not create or repair a hosted migration ledger.
SELECT to_regclass('supabase_migrations.schema_migrations') AS existing_ledger,
  to_regprocedure('public.advance_word_updated_at()') AS word_version_function;
-- Gateway configuration may live outside PostgreSQL; absent rows do NOT prove
-- schemas are unexposed. Owner must separately inspect Data API/Auth settings.
SELECT name,setting FROM pg_settings WHERE name IN ('pgrst.db_schemas','pgrst.db_extra_search_path','pgrst.db_anon_role');
ROLLBACK;
