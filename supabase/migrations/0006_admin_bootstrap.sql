-- ============================================================================
-- ADMIN BOOTSTRAP + ROLE ADMINISTRATION
--
-- Closes B-3 from the 2026-09-08 audit: no admin account could be created by
-- any supported means. `prevent_role_self_escalation` fired for every actor
-- including the service_role key, there was no seed admin, and provider
-- configuration is only reachable from /admin — so a fresh deployment was
-- permanently stuck in its empty state.
--
-- Two changes fix it:
--   1. The escalation trigger now exempts the service_role. That role is only
--      ever held by server-side code holding SUPABASE_SERVICE_ROLE_KEY, which
--      is exactly the trust boundary the trigger was trying to protect.
--      Browser clients (anon / authenticated) are still blocked.
--   2. `bootstrap_first_admin(email)` promotes one named account, and only
--      while the system has zero admins. Once an admin exists it refuses,
--      so it cannot be replayed later as a privilege-escalation primitive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. service_role exemption on the escalation guard
-- ----------------------------------------------------------------------------
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Server-side code holding the service-role key is already fully trusted;
  -- it is the mechanism admins are provisioned *with*, not a threat to guard
  -- against. Everything reachable from a browser is anon or authenticated.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Only an admin can change role or is_active.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. First-admin bootstrap
--
-- Callable only by the service role (see the revoke below), so the intended
-- path is `npm run bootstrap:admin -- you@example.com`, which runs
-- scripts/bootstrap-admin.mjs with SUPABASE_SERVICE_ROLE_KEY from the server
-- environment. The account must already exist — sign up through the UI first.
-- ----------------------------------------------------------------------------
create or replace function public.bootstrap_first_admin(p_email text)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_admin_count integer;
begin
  select count(*) into v_admin_count
    from public.profiles where role = 'admin' and is_active;

  if v_admin_count > 0 then
    raise exception
      'An admin already exists. Promote further admins from Admin -> Clients instead.'
      using errcode = '42501';
  end if;

  select * into v_profile
    from public.profiles
    where lower(email) = lower(btrim(p_email));

  if not found then
    raise exception
      'No account found for %. Sign up through the app first, confirm the email, then re-run the bootstrap.', p_email;
  end if;

  update public.profiles
    set role = 'admin', is_active = true, updated_at = now()
    where id = v_profile.id
    returning * into v_profile;

  insert into public.audit_logs(actor_id, action, target_table, target_id, metadata)
  values (v_profile.id, 'admin.bootstrap', 'profiles', v_profile.id::text,
          jsonb_build_object('email', v_profile.email, 'note', 'first admin bootstrapped'));

  return v_profile;
end;
$$;

revoke all on function public.bootstrap_first_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(text) to service_role;

-- ----------------------------------------------------------------------------
-- 3. Admin-performed role changes, with audit trail
--
-- Runs SECURITY DEFINER but re-checks is_admin() for the *calling* user, so
-- holding the function grant is not itself sufficient — the caller must
-- genuinely be an active admin. Self-demotion of the last remaining admin is
-- refused, which prevents an admin locking the whole organisation out.
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role public.app_role
)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_remaining integer;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  if p_role <> 'admin' then
    select count(*) into v_remaining
      from public.profiles
      where role = 'admin' and is_active and id <> p_user_id;
    if v_remaining = 0 then
      raise exception 'Refusing to remove the last remaining admin.' using errcode = '42501';
    end if;
  end if;

  update public.profiles
    set role = p_role, updated_at = now()
    where id = p_user_id
    returning * into v_profile;

  if not found then
    raise exception 'User not found.';
  end if;

  insert into public.audit_logs(actor_id, action, target_table, target_id, metadata)
  values (v_actor, 'admin.set_role', 'profiles', p_user_id::text,
          jsonb_build_object('role', p_role));

  return v_profile;
end;
$$;

grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Admin-performed activation/deactivation
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_user_active(
  p_user_id uuid,
  p_is_active boolean
)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_remaining integer;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  if not p_is_active then
    select count(*) into v_remaining
      from public.profiles
      where role = 'admin' and is_active and id <> p_user_id;
    if v_remaining = 0 then
      raise exception 'Refusing to deactivate the last remaining admin.' using errcode = '42501';
    end if;
  end if;

  update public.profiles
    set is_active = p_is_active, updated_at = now()
    where id = p_user_id
    returning * into v_profile;

  if not found then
    raise exception 'User not found.';
  end if;

  insert into public.audit_logs(actor_id, action, target_table, target_id, metadata)
  values (v_actor, 'admin.set_active', 'profiles', p_user_id::text,
          jsonb_build_object('is_active', p_is_active));

  return v_profile;
end;
$$;

grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Audit-log writes from admin server actions.
--    audit_logs has no client INSERT policy (0002); this definer function is
--    the single sanctioned write path, and it stamps the actor itself rather
--    than trusting a caller-supplied id.
-- ----------------------------------------------------------------------------
create or replace function public.write_audit_log(
  p_action text,
  p_target_table text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  insert into public.audit_logs(actor_id, action, target_table, target_id, metadata)
  values (auth.uid(), p_action, p_target_table, p_target_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

grant execute on function public.write_audit_log(text, text, text, jsonb) to authenticated;
