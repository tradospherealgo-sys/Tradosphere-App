-- ============================================================================
-- Fix admin_verify_signal: CASE branches need explicit enum casts.
--
-- Discovered by the Mission 8 review-flow test (13_signal_os_review.sql) —
-- this RPC had never been exercised by any test before, so the bug shipped
-- silently since 0007. `case when p_release then 'verified' else 'rejected'
-- end` resolves its branches as `text`, and Postgres will not implicitly cast
-- a `text` expression onto an enum column (only an untyped string literal
-- assigned directly gets that implicit cast) — the UPDATE fails at runtime
-- with "column ... is of type verification_state but expression is of type
-- text" the moment it actually runs. Same issue for the `status` branch.
-- Casting each literal explicitly fixes it without changing behavior.
-- ============================================================================

create or replace function public.admin_verify_signal(
  p_signal_id uuid,
  p_release boolean default true
)
returns public.signals
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_signal public.signals%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  update public.signals
    set verification_state = case when p_release then 'verified' else 'rejected' end::public.verification_state,
        status = case when p_release then 'active' else 'cancelled' end::public.signal_status,
        verified_by = v_actor,
        verified_at = now(),
        updated_at = now()
    where id = p_signal_id
    returning * into v_signal;

  if not found then
    raise exception 'Signal not found.';
  end if;

  insert into public.signal_events(signal_id, event_type, actor_id, detail)
  values (p_signal_id,
          case when p_release then 'verified' else 'rejected' end,
          v_actor,
          case when p_release then 'Released to clients.' else 'Rejected; not shown as tradeable.' end);

  -- Broadcast notification (user_id null = everyone) only on release.
  if p_release then
    insert into public.notifications(user_id, kind, title, body)
    values (null, 'signal',
            format('New verified signal: %s %s', v_signal.direction, v_signal.symbol),
            v_signal.rationale);
  end if;

  return v_signal;
end;
$$;
