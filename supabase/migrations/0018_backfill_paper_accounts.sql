-- Backfill paper_accounts for any profile that predates or bypassed
-- handle_new_user() (e.g. rows created directly rather than through Supabase
-- Auth signup). Idempotent: safe to re-run on every deploy so no profile can
-- ever end up permanently without an account again.
insert into public.paper_accounts (user_id, starting_capital, cash_balance)
select p.id, 1000000, 1000000
from public.profiles p
left join public.paper_accounts a on a.user_id = p.id
where a.user_id is null
on conflict (user_id) do nothing;
