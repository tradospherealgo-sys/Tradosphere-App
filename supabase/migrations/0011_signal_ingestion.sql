-- ============================================================================
-- SYSTEM-SIDE SIGNAL RELEASE
--
-- `admin_verify_signal` is gated on `is_admin()`, which reads `auth.uid()`.
-- The Telegram webhook has no signed-in user — it runs as the service role —
-- so it cannot use that path even though it legitimately needs to release a
-- signal from a source the desk has marked trusted + auto_verify.
--
-- Rather than loosening the admin function (which would let any authenticated
-- caller release a signal), this adds a separate entry point that:
--   * is executable by the service role only — `authenticated` is explicitly
--     revoked, so a browser client cannot reach it even with a valid session;
--   * refuses to release a signal whose source is not both trusted and
--     auto_verify, so the desk's own configuration is the authorisation
--     decision rather than the caller's;
--   * writes the same lifecycle event and broadcast notification as the
--     admin path, in the same transaction.
-- ============================================================================

create or replace function public.system_release_signal(p_signal_id uuid)
returns public.signals
language plpgsql
security definer set search_path = public
as $$
declare
  v_signal public.signals%rowtype;
  v_ok boolean;
begin
  select s.is_trusted and s.auto_verify
    into v_ok
    from public.signals sig
    join public.signal_sources s on s.id = sig.source_id
   where sig.id = p_signal_id;

  if v_ok is null then
    raise exception 'Signal not found.';
  end if;

  if not v_ok then
    raise exception 'Source is not configured for automatic release.'
      using errcode = '42501';
  end if;

  update public.signals
     set verification_state = 'verified',
         status = 'active',
         verified_at = now(),
         updated_at = now()
   where id = p_signal_id
     and verification_state = 'unverified'
  returning * into v_signal;

  -- Already reviewed by a human in the meantime: leave their decision alone.
  if not found then
    select * into v_signal from public.signals where id = p_signal_id;
    return v_signal;
  end if;

  insert into public.signal_events(signal_id, event_type, detail)
  values (p_signal_id, 'verified',
          'Released automatically — source is marked trusted with auto-verify.');

  insert into public.notifications(user_id, kind, title, body)
  values (null, 'signal',
          format('New verified signal: %s %s', v_signal.direction, v_signal.symbol),
          v_signal.rationale);

  return v_signal;
end;
$$;

revoke all on function public.system_release_signal(uuid) from public;
revoke all on function public.system_release_signal(uuid) from anon;
revoke all on function public.system_release_signal(uuid) from authenticated;
grant execute on function public.system_release_signal(uuid) to service_role;
