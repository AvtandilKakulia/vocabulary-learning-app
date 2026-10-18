-- ONLY run by the disposable-cluster runner. No hosted credentials or Auth data.
-- Reuse the existing word-version fixture without changing that test suite.
\ir ../word-version/fixture.sql

-- A real non-superuser session, like the gateway's role-switching connection.
-- It cannot SET ROLE postgres/service_role, create roles or bypass RLS.
CREATE ROLE authorization_gateway LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT anon, authenticated TO authorization_gateway;

-- Model both legacy and JSON JWT subject settings. These settings are supplied
-- by this trusted test gateway, NOT cryptographically validated by PostgreSQL.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

-- Deliberately broad Supabase-like defaults: the unchanged migrations must
-- revoke them on the application objects. Function PUBLIC EXECUTE is also the
-- PostgreSQL default. These are fixture assumptions, not Production facts.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
