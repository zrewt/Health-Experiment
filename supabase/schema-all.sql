-- ============================================================================
-- Aevum — complete database schema (ONE FILE)
-- ============================================================================
-- Paste this entire file into the Supabase SQL editor and run it once.
-- It is safe to run again: every statement is idempotent.
--
-- Consolidates supabase/schema.sql + schema-screen3..7.sql + the drafted
-- caffeine-time check. The per-screen files are kept as the historical record.
--
-- Creates / ensures:
--   1. public.experiment_setup        (one row per user)
--   2. public.experiment_entries      (one row per user + local date)
--   3. public.experiment_consent      (append-only audit log)
--   4. public.experiment_plans        (jsonb plan + result snapshot)
--   5. locked-day trigger for completed experiments
--   6. public.delete_own_account()    (in-app account deletion)
--   7. OPTIONAL caffeine-shape check  (disabled by default, see the end)
-- ============================================================================


-- ============================================================================
-- 1. Experiment setup
-- ============================================================================
create table if not exists public.experiment_setup (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  experiment_id text not null default 'caffeine-cutoff',
  cutoff_time text not null default '12:00',
  screening_answer text not null, -- 'usually' | 'sometimes' | 'rarely_or_never'
  run_in_start_date text not null, -- 'YYYY-MM-DD'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_experiment_setup_user unique (user_id)
);

-- Added later, for the periodic feasibility re-check.
alter table public.experiment_setup
  add column if not exists next_check_date date;

alter table public.experiment_setup enable row level security;

drop policy if exists "Users can view own experiment setup" on public.experiment_setup;
create policy "Users can view own experiment setup"
  on public.experiment_setup for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own experiment setup" on public.experiment_setup;
create policy "Users can insert own experiment setup"
  on public.experiment_setup for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own experiment setup" on public.experiment_setup;
create policy "Users can update own experiment setup"
  on public.experiment_setup for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ============================================================================
-- 2. Daily experiment entries (upsert by user_id + local date)
-- ============================================================================
create table if not exists public.experiment_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null, -- 'YYYY-MM-DD'
  sleep_minutes integer, -- nullable: null if skipped
  last_caffeine_time text, -- nullable: 'HH:MM' | 'none' | null
  edited_at timestamptz not null default now(),
  constraint uq_experiment_entries_user_date unique (user_id, date)
);

-- Marks rows written by the in-app dev sample loader, so only those can be cleared.
alter table public.experiment_entries
  add column if not exists is_sample boolean not null default false;

-- Screens-off cutoff test: last screen use, 'HH:MM' | 'none' | null. Null for caffeine-only days.
alter table public.experiment_entries
  add column if not exists last_screen_time text;

alter table public.experiment_entries enable row level security;

drop policy if exists "Users can view own experiment entries" on public.experiment_entries;
create policy "Users can view own experiment entries"
  on public.experiment_entries for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own experiment entries" on public.experiment_entries;
create policy "Users can insert own experiment entries"
  on public.experiment_entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own experiment entries" on public.experiment_entries;
create policy "Users can update own experiment entries"
  on public.experiment_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deleting is allowed only for the user's own sample rows; real entries are never
-- deleted by the app (they are locked once their experiment has a result).
drop policy if exists "Users can delete own sample entries" on public.experiment_entries;
create policy "Users can delete own sample entries"
  on public.experiment_entries for delete
  using (auth.uid() = user_id and is_sample = true);


-- ============================================================================
-- 3. Append-only consent log (never updated or deleted)
-- ============================================================================
create table if not exists public.experiment_consent (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null, -- 'health-data'
  policy_version text not null, -- e.g. '2026-10-v1'
  granted boolean not null,
  created_at timestamptz not null default now()
);

alter table public.experiment_consent enable row level security;

drop policy if exists "Users can view own consent records" on public.experiment_consent;
create policy "Users can view own consent records"
  on public.experiment_consent for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own consent records" on public.experiment_consent;
create policy "Users can insert own consent records"
  on public.experiment_consent for insert
  with check (auth.uid() = user_id);

-- No update or delete policy on purpose: the consent trail must stay append-only.


-- ============================================================================
-- 4. Experiment plans (jsonb plan + stored result snapshot)
-- ============================================================================
create table if not exists public.experiment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan jsonb not null,
  status text not null default 'scheduled',
  created_at timestamptz default now()
);

-- Added later: the stored verdict snapshot and its completion time.
alter table public.experiment_plans
  add column if not exists result jsonb,
  add column if not exists completed_at timestamptz;

alter table public.experiment_plans enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'experiment_plans' and policyname = 'Users can view own experiment plans'
  ) then
    create policy "Users can view own experiment plans"
      on public.experiment_plans for select to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'experiment_plans' and policyname = 'Users can insert own experiment plans'
  ) then
    create policy "Users can insert own experiment plans"
      on public.experiment_plans for insert to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'experiment_plans' and policyname = 'Users can update own experiment plans'
  ) then
    create policy "Users can update own experiment plans"
      on public.experiment_plans for update to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- No delete policy: rows age out only with the auth.users cascade.

-- The app writes exactly these three statuses.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_experiment_plans_status'
  ) then
    alter table public.experiment_plans
      add constraint chk_experiment_plans_status
      check (status in ('scheduled', 'completed', 'cancelled'));
  end if;
end $$;

-- At most one live experiment per user. Completed plans stay in the table as
-- history, so the uniqueness applies to 'scheduled' only (this replaces the
-- earlier non-cancelled index that blocked starting a second experiment).
drop index if exists public.uq_experiment_plans_non_cancelled_user;

create unique index if not exists uq_experiment_plans_scheduled_user
  on public.experiment_plans (user_id)
  where status = 'scheduled';


-- ============================================================================
-- 5. Server-side edit lock for completed experiments
-- ============================================================================
-- Entries dated inside a completed plan's schedule can no longer be updated or
-- deleted, so a saved verdict always matches the log it was computed from.
-- Entries outside that window (including the baseline run-in) stay editable.
--
-- One exception: deleting the account itself. That path deletes the user's rows and
-- the account row in one transaction, and the lock must not be able to stop it, so
-- public.delete_own_account() raises a transaction-local flag this trigger respects.
-- Only that SECURITY DEFINER function can set the flag: the API cannot, because there
-- is no endpoint that runs arbitrary SQL or set_config for a signed-in caller.
-- ============================================================================
create or replace function public.check_entry_edit_lock()
returns trigger
language plpgsql
security invoker
as $$
declare
  target_user_id uuid;
  target_date text;
  locked boolean;
begin
  if coalesce(current_setting('aevum.account_delete', true), '') = 'on' then
    if (TG_OP = 'DELETE') then
      return OLD;
    else
      return NEW;
    end if;
  end if;

  -- A sample row is dev scaffolding, not a logged day. The app's delete policy already
  -- allows only sample rows to be removed, so the lock has nothing to protect here and
  -- must not turn "Delete sample entries" into a no-op after a test has been completed.
  if (TG_OP = 'DELETE' and OLD.is_sample) then
    return OLD;
  end if;

  if (TG_OP = 'DELETE') then
    target_user_id := OLD.user_id;
    target_date := OLD.date;
  else
    target_user_id := NEW.user_id;
    target_date := NEW.date;
  end if;

  -- Is target_date part of any completed plan's schedule for this user?
  select exists (
    select 1
    from public.experiment_plans ep,
         jsonb_array_elements(ep.plan->'schedule') as s
    where ep.user_id = target_user_id
      and ep.status = 'completed'
      and (s->>'date') = target_date
  ) into locked;

  if locked then
    raise exception 'Entry for date % is locked because it belongs to a completed experiment.', target_date
      using errcode = 'integrity_constraint_violation';
  end if;

  if (TG_OP = 'DELETE') then
    return OLD;
  else
    return NEW;
  end if;
end;
$$;

drop trigger if exists trg_prevent_completed_entry_edits on public.experiment_entries;

create trigger trg_prevent_completed_entry_edits
  before update or delete
  on public.experiment_entries
  for each row
  execute function public.check_entry_edit_lock();


-- ============================================================================
-- 6. In-app account deletion (App Store requirement)
-- ============================================================================
-- Deletes the caller's rows and then the caller's auth.users row. Everything is
-- removed inside one transaction, so a failure leaves the account exactly as it was.
--
-- The rows are deleted explicitly and first, rather than relying on the cascade, so
-- the order never matters: the locked-day trigger would otherwise still see the
-- completed plan while the entries under it were being deleted, and refuse.
-- ============================================================================
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege';
  end if;

  -- Transaction-local, and only reachable from this function, so the locked-day rule
  -- keeps protecting a finished experiment from every client-side edit.
  perform set_config('aevum.account_delete', 'on', true);

  delete from public.experiment_entries where user_id = caller_id;
  delete from public.experiment_plans   where user_id = caller_id;
  delete from public.experiment_setup   where user_id = caller_id;
  delete from public.experiment_consent where user_id = caller_id;

  delete from auth.users
  where id = caller_id;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;


-- ============================================================================
-- 7. OPTIONAL — shape check on last_caffeine_time  (NOT enabled by default)
-- ============================================================================
-- Allows only a strict 24-hour 'HH:mm', the literal 'none', or NULL. It is
-- NOT VALID, so existing rows are never rejected or rewritten.
--
-- Left commented out on purpose: the offline retry queue re-writes already
-- stored values verbatim, so a legacy malformed row (e.g. '9:30') would stop
-- re-syncing once this is enforced. The app already refuses to write a
-- malformed time, so this is defence in depth rather than a requirement.
-- Uncomment the block below only if you have no legacy malformed rows.
-- ============================================================================
-- do $$
-- begin
--   if not exists (
--     select 1 from pg_constraint
--     where conname = 'experiment_entries_last_caffeine_time_check'
--   ) then
--     alter table public.experiment_entries
--       add constraint experiment_entries_last_caffeine_time_check
--       check (
--         last_caffeine_time is null
--         or last_caffeine_time = 'none'
--         or last_caffeine_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
--       ) not valid;
--   end if;
-- end $$;
