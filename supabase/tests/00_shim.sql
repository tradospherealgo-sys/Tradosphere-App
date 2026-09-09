-- ============================================================================
-- Supabase platform shim — TEST HARNESS ONLY.
--
-- Recreates the small surface of the hosted Supabase platform that the
-- migrations depend on (three roles, the `auth` schema, `auth.users`,
-- `auth.uid()`, `auth.role()`) so the migration set can be applied to a plain
-- Postgres container and exercised. It is never applied to a real project —
-- Supabase provides all of this already.
--
-- `auth.uid()` reads `request.jwt.claims` exactly as the hosted function does,
-- so a test switches identity the same way PostgREST does: by setting that
-- GUC. Nothing here weakens the policies under test; it only makes them
-- reachable.
-- ============================================================================

create extension if not exists "pgcrypto";

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

grant anon, authenticated, service_role to current_user;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  );
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Default privileges.
--
-- Hosted Supabase grants the API roles broad table privileges and relies on RLS
-- to decide what they can actually reach; the migrations are written against
-- that posture (0004 revokes writes on the financial tables *back* out of it).
-- Reproducing it here is what makes the RLS and lockdown assertions meaningful
-- — without it every statement would fail on a missing grant instead of on the
-- policy under test.
--
-- These are default privileges, so they apply to the tables the migrations are
-- about to create, not to anything that already exists.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
