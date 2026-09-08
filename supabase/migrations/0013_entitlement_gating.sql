-- ============================================================================
-- ENTITLEMENT GATING AT THE ROW LEVEL
--
-- Hiding a paid surface in the UI is not access control — the anon key is
-- public and a client can query the table directly. These policies move the
-- subscription check onto the rows themselves, so an expired or absent
-- subscription means the data is genuinely unreadable, not merely unrendered.
--
-- `has_entitlement` returns true for admins and re-checks `current_period_end`
-- against now(), so a lapsed subscription loses access immediately even if no
-- sweep has flipped its status yet.
--
-- Bootstrapping note: on a fresh install no plans exist, so no client holds
-- the 'signals' or 'option_chain' entitlement and these surfaces read as empty
-- for non-admins. That is intended — publish a plan and grant it before
-- onboarding clients. The entitlement keys used here are exactly the strings
-- an admin types into a plan's `entitlements` array.
-- ============================================================================

drop policy if exists signals_read_released on public.signals;
create policy signals_read_released on public.signals
  for select using (
    is_admin()
    or (
      auth.role() = 'authenticated'
      and verification_state = 'verified'
      and status <> 'pending'
      and public.has_entitlement('signals')
    )
  );

drop policy if exists signal_events_read on public.signal_events;
create policy signal_events_read on public.signal_events
  for select using (
    is_admin()
    or exists (
      select 1 from public.signals s
      where s.id = signal_events.signal_id
        and s.verification_state = 'verified'
        and s.status <> 'pending'
        and public.has_entitlement('signals')
    )
  );

drop policy if exists occ_read_all on public.option_chain_snapshots;
create policy occ_read_all on public.option_chain_snapshots
  for select using (
    auth.role() = 'authenticated' and public.has_entitlement('option_chain')
  );
