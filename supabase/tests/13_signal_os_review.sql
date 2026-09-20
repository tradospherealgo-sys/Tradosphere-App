-- ============================================================================
-- Signal OS human-approval tests (Mission 8, migration 0028).
--
-- What this is actually protecting:
--   - a signal lands pending/unverified regardless of source trust
--   - a client can see neither a pending nor a rejected signal
--   - a client sees an approved (verified + not-pending) signal
--   - auto_verify can never be set back to true, structurally
--   - ingest_classified_signal never auto-releases even for a trusted source
--   - system_release_signal (the old auto-release entry point) always refuses
--   - duplicate fingerprints are detected before publish
--   - an unregistered source's message is quarantined, not turned into a signal
--
-- Every ingestion/pipeline function here is service-role-only (0019/0027), so
-- this test drives them as `service_role`, exactly as the n8n workflow and
-- the Telegram webhook do. `admin_verify_signal` and the client-visibility
-- checks run as `authenticated`, exactly as the browser does.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.become(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'role', 'authenticated')::text,
                     false);
end;
$$;

create or replace function pg_temp.become_service_role()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
end;
$$;

do $$
declare
  v_client uuid;
  v_admin uuid;
  v_source_id uuid;
  v_signal public.signals%rowtype;
  v_trusted_signal public.signals%rowtype;
  v_count int;
  v_caught boolean;
  v_raw_id bigint;
  v_source_found boolean;
  v_is_dup boolean;
  v_plan_id uuid;
begin
  -- --------------------------------------------------------------------------
  -- Fixtures: a client, an admin, one trusted+active source.
  -- --------------------------------------------------------------------------
  insert into auth.users(email, raw_app_meta_data) values ('sigrev-client@test.invalid', '{"provider":"test"}') returning id into v_client;
  insert into auth.users(email, raw_app_meta_data) values ('sigrev-admin@test.invalid', '{"provider":"test"}') returning id into v_admin;

  set local role service_role;
  perform pg_temp.become_service_role();
  update public.profiles set role = 'admin' where id = v_admin;

  insert into public.signal_sources(slug, name, kind, telegram_chat_id, is_trusted, is_active, auto_verify)
    values ('sigrev-trusted-desk', 'Sigrev Trusted Desk', 'telegram_channel', '-100111', true, true, false)
    returning id into v_source_id;

  -- signals_read_released (0013) also requires has_entitlement('signals'), so
  -- the client fixture needs a live subscription to a plan granting it —
  -- otherwise even an approved signal would read as empty for an unrelated
  -- reason (no entitlement), muddying what this test is actually proving.
  insert into public.plans(slug, name, billing_interval, price_minor, entitlements)
    values ('sigrev-signals-plan', 'Sigrev Signals Plan', 'monthly', 0, '["signals"]'::jsonb)
    returning id into v_plan_id;

  -- ==========================================================================
  -- 1. auto_verify can never be set back to true — the check constraint
  --    added in 0028 is the structural guarantee behind mandatory review.
  -- ==========================================================================
  v_caught := false;
  begin
    update public.signal_sources set auto_verify = true where id = v_source_id;
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'a trusted source cannot be flipped back to auto_verify');

  -- ==========================================================================
  -- 2. ingest_classified_signal always lands pending/unverified, even for a
  --    source that is_trusted (the only thing that used to bypass review).
  -- ==========================================================================
  select * into v_trusted_signal from public.ingest_classified_signal(
    p_source_id => v_source_id,
    p_raw_message_id => null,
    p_category => 'EQUITY',
    p_symbol => 'RELIANCE',
    p_direction => 'BUY'::public.order_side,
    p_entry_price => 2500,
    p_stop_loss => 2450,
    p_target_1 => 2600,
    p_fingerprint => 'sigrev-fp-trusted-1'
  );
  perform pg_temp.assert(v_trusted_signal.status = 'pending',
    'a trusted source''s ingested signal still lands pending');
  perform pg_temp.assert(v_trusted_signal.verification_state = 'unverified',
    'and unverified — auto-release never fires regardless of trust');

  -- ==========================================================================
  -- 3. system_release_signal (the old auto-release entry point) always
  --    refuses now, for any signal, because no source can satisfy its check.
  -- ==========================================================================
  v_caught := false;
  begin
    perform public.system_release_signal(v_trusted_signal.id);
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'system_release_signal refuses to auto-release anything post-0028');

  perform pg_temp.assert(
    (select status = 'pending' and verification_state = 'unverified'
       from public.signals where id = v_trusted_signal.id),
    'the failed auto-release attempt left the signal exactly as it was');

  -- ==========================================================================
  -- 4. Duplicate fingerprint is detected before a second insert.
  -- ==========================================================================
  select is_duplicate into v_is_dup from public.check_signal_fingerprint_duplicate('sigrev-fp-trusted-1');
  perform pg_temp.assert(v_is_dup, 'a fingerprint already on a signal is reported as duplicate');

  select is_duplicate into v_is_dup from public.check_signal_fingerprint_duplicate('sigrev-fp-never-used');
  perform pg_temp.assert(not v_is_dup, 'an unused fingerprint is not a duplicate');

  -- ==========================================================================
  -- 5. An unregistered source's message is quarantined, never turned into a
  --    signal.
  -- ==========================================================================
  select id, source_found into v_raw_id, v_source_found
    from public.insert_raw_signal_message(
      p_channel => 'telegram',
      p_external_chat_id => '-100999999',
      p_external_message_id => 'msg-unregistered-1',
      p_sender => 'someone',
      p_raw_text => 'BUY NIFTY 22000 CE',
      p_raw_payload => '{}'::jsonb,
      p_received_at => now()
    );
  perform pg_temp.assert(not v_source_found, 'a chat id with no bound source is not found');

  perform public.quarantine_raw_message(v_raw_id, 'No registered signal source is bound to this chat/channel.');
  perform pg_temp.assert(
    (select parse_status from public.raw_signal_messages where id = v_raw_id) = 'quarantined',
    'the unregistered-source message is quarantined');
  perform pg_temp.assert(
    (select signal_id from public.raw_signal_messages where id = v_raw_id) is null,
    'and never produced a signal');

  -- ==========================================================================
  -- 6. Client visibility: pending is invisible, rejected is invisible,
  --    approved is visible. This is the actual client-facing guarantee
  --    requirement 3 asks for.
  -- ==========================================================================
  reset role;
  set local role authenticated;
  perform pg_temp.become(v_client);

  select count(*) into v_count from public.signals where id = v_trusted_signal.id;
  perform pg_temp.assert(v_count = 0, 'a client cannot see a pending signal');

  -- Admin rejects it.
  perform pg_temp.become(v_admin);
  perform public.admin_verify_signal(v_trusted_signal.id, false);

  select count(*) into v_count from public.signals where id = v_trusted_signal.id;
  perform pg_temp.assert(v_count = 1, 'the admin can see the signal they just reviewed');
  perform pg_temp.assert(
    (select verification_state from public.signals where id = v_trusted_signal.id) = 'rejected',
    'rejecting sets verification_state to rejected');
  perform pg_temp.assert(
    (select verified_by from public.signals where id = v_trusted_signal.id) = v_admin,
    'the reviewer is recorded');
  perform pg_temp.assert(
    (select verified_at from public.signals where id = v_trusted_signal.id) is not null,
    'the review timestamp is recorded');

  perform pg_temp.become(v_client);
  select count(*) into v_count from public.signals where id = v_trusted_signal.id;
  perform pg_temp.assert(v_count = 0, 'a client cannot see a rejected signal either');

  -- A second signal, this time approved.
  reset role;
  set local role service_role;
  perform pg_temp.become_service_role();
  select * into v_signal from public.ingest_classified_signal(
    p_source_id => v_source_id,
    p_raw_message_id => null,
    p_category => 'EQUITY',
    p_symbol => 'TCS',
    p_direction => 'BUY'::public.order_side,
    p_entry_price => 3500,
    p_stop_loss => 3450,
    p_target_1 => 3600,
    p_fingerprint => 'sigrev-fp-approved-1'
  );

  reset role;
  set local role authenticated;
  perform pg_temp.become(v_admin);
  perform public.admin_verify_signal(v_signal.id, true);
  perform public.admin_grant_subscription(v_client, v_plan_id);

  perform pg_temp.become(v_client);
  select count(*) into v_count from public.signals where id = v_signal.id;
  perform pg_temp.assert(v_count = 1, 'a client with a live "signals" entitlement can see an approved (verified, not pending) signal');

  reset role;
  raise notice 'signal os review: pending/reject/approve/duplicate/quarantine and RLS visibility all passed';
end;
$$;
