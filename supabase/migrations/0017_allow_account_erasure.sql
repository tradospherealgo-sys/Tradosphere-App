-- ============================================================================
-- ERASING A USER MUST REMAIN POSSIBLE
--
-- The ledger guard in 0004 rejects any write to orders/trades/positions that
-- did not come from a trading function. It was written with a live user in
-- mind and, correctly, does not care who is asking — service_role included.
--
-- The unintended consequence: deleting a row from auth.users cascades
-- (auth.users -> profiles -> orders/trades/positions), those cascade deletes
-- fire this trigger, and the trigger raises. The delete fails with nothing
-- more descriptive than "Database error deleting user". So closing an
-- account, or honouring an erasure request, was impossible — the lockdown
-- had quietly become a retention policy nobody chose.
--
-- The fix keeps the guard absolute for anything that could be an attack and
-- carves out exactly one case: a ledger row may be deleted without the
-- trusted flag only when the profile that owns it no longer exists. During a
-- cascade the parent row is already gone by the time the child trigger runs,
-- so this is true precisely when the delete is part of removing the owner —
-- and never for a signed-in user deleting their own inconvenient trades,
-- whose profile is very much still there.
--
-- Deliberately narrow: DELETE only. Inserts and updates are unaffected, so an
-- orphaned row still cannot be created or edited.
-- ============================================================================

create or replace function public.require_trusted_write()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(current_setting('tradosphere.trusted_write', true), 'off') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE'
     and not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return old;
  end if;

  raise exception
    '% is an append-only ledger written by the trading engine; direct writes are rejected.', tg_table_name
    using errcode = '42501';
end;
$$;
