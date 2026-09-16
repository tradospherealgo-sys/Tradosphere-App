-- ============================================================================
-- INVITE-CODE GATED SIGNUP
--
-- Signup was previously fully open. This adds an invite_codes table (admin
-- managed, mirrors the integration_configs_admin_only / system_settings_
-- admin_only pattern: no client-facing select, all access via is_admin()),
-- a redeem_invite_code() security-definer function that atomically checks
-- and consumes a code, and wires redemption into handle_new_user() so a
-- password signup cannot create an account without a valid code even if a
-- caller hits Supabase's signUp API directly rather than going through the
-- app's form.
--
-- OAuth (Google) signup cannot carry a code through raw_user_meta_data the
-- way password signup can, so it is gated separately in the app layer
-- (src/app/auth/callback/route.ts), which calls this same
-- redeem_invite_code() RPC and deletes the just-created account if no valid
-- code was supplied. That is why redeem_invite_code is also granted to
-- authenticated, not just invoked internally by the trigger.
-- ============================================================================

create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  note text,
  max_uses integer not null default 1 check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  is_active boolean not null default true,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;

create policy invite_codes_admin_only on public.invite_codes
  for all using (public.is_admin()) with check (public.is_admin());

-- Atomically validates and consumes one use of a code. Returns false for
-- any reason a code doesn't apply (missing, inactive, expired, exhausted)
-- rather than distinguishing the reason, so a failed guess reveals nothing
-- about which codes exist.
create or replace function public.redeem_invite_code(p_code text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.invite_codes%rowtype;
begin
  if p_code is null or btrim(p_code) = '' then
    return false;
  end if;

  select * into v_row from public.invite_codes
    where code = btrim(p_code) and is_active
    for update;

  if not found then
    return false;
  end if;
  if v_row.expires_at is not null and v_row.expires_at < now() then
    return false;
  end if;
  if v_row.use_count >= v_row.max_uses then
    return false;
  end if;

  update public.invite_codes
    set use_count = use_count + 1
    where id = v_row.id;

  return true;
end;
$$;

grant execute on function public.redeem_invite_code(text) to anon, authenticated;

-- Re-point handle_new_user() through the invite gate for password signups.
-- OAuth signups (provider <> 'email') are intentionally left alone here —
-- see the header comment for where they're actually gated.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_provider text := coalesce(new.raw_app_meta_data->>'provider', 'email');
begin
  if v_provider = 'email' then
    if not public.redeem_invite_code(new.raw_user_meta_data->>'invite_code') then
      raise exception 'A valid invite code is required to create an account.'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  insert into public.paper_accounts (user_id, starting_capital, cash_balance)
  values (new.id, 1000000, 1000000)
  on conflict (user_id) do nothing;

  return new;
end;
$$;
