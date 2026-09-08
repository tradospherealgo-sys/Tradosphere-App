-- ----------------------------------------------------------------------------
-- 0014 — advance warning before a subscription lapses
--
-- 0008 notifies users *after* their period ends, by which point access is
-- already gone. This adds the warning that goes out before the fact.
--
-- The idempotency is the point: the sweep runs daily, so without a marker
-- every user inside the warning window would be told again every morning.
-- `expiry_warned_at` records that the warning for the *current* period has
-- been sent; a renewal moves `current_period_end` forward, and the guard
-- compares against that, so the next period gets its own warning.
-- ----------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists expiry_warned_at timestamptz;

create or replace function public.warn_expiring_subscriptions(p_days integer default 3)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Warning window must be between 1 and 30 days.';
  end if;

  with warned as (
    update public.subscriptions s
      set expiry_warned_at = now(), updated_at = now()
      where s.status in ('trialing', 'active', 'past_due')
        and s.current_period_end > now()
        and s.current_period_end <= now() + make_interval(days => p_days)
        -- Not yet warned for this period. A renewal pushes the end date out
        -- past the previous warning, which re-arms the check.
        and (s.expiry_warned_at is null or s.expiry_warned_at < s.current_period_end - make_interval(days => p_days))
      returning s.user_id, s.plan_id, s.current_period_end
  )
  insert into public.notifications(user_id, kind, title, body)
  select w.user_id, 'system',
         format('%s plan expires on %s', p.name, to_char(w.current_period_end, 'DD Mon YYYY')),
         'Renew before then to keep access to signals, the option chain and premium courses.'
  from warned w
  join public.plans p on p.id = w.plan_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- System-only, exactly like expire_lapsed_subscriptions: a client has no
-- reason to trigger a fan-out of notifications.
revoke all on function public.warn_expiring_subscriptions(integer) from public, anon, authenticated;
grant execute on function public.warn_expiring_subscriptions(integer) to service_role;
