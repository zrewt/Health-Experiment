-- Experiment Storage Schema with Row Level Security (RLS)
-- DO NOT RUN AUTOMATICALLY: Provided as text per user instructions.
-- Apply in the Supabase SQL editor when configuring the remote database.

-- 1. Experiment Setup
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

alter table public.experiment_setup enable row level security;

create policy "Users can view own experiment setup"
  on public.experiment_setup for select
  using (auth.uid() = user_id);

create policy "Users can insert own experiment setup"
  on public.experiment_setup for insert
  with check (auth.uid() = user_id);

create policy "Users can update own experiment setup"
  on public.experiment_setup for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Daily Experiment Entries (Upsert by user_id and local date)
create table if not exists public.experiment_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null, -- 'YYYY-MM-DD'
  sleep_minutes integer, -- nullable: null if skipped
  last_caffeine_time text, -- nullable: 'HH:MM' | 'none' | null
  edited_at timestamptz not null default now(),
  constraint uq_experiment_entries_user_date unique (user_id, date)
);

alter table public.experiment_entries enable row level security;

create policy "Users can view own experiment entries"
  on public.experiment_entries for select
  using (auth.uid() = user_id);

create policy "Users can insert own experiment entries"
  on public.experiment_entries for insert
  with check (auth.uid() = user_id);

create policy "Users can update own experiment entries"
  on public.experiment_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. Append-Only Consent Log (Never update or delete)
create table if not exists public.experiment_consent (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null, -- 'health-data'
  policy_version text not null, -- e.g. '2026-10-v1'
  granted boolean not null,
  created_at timestamptz not null default now()
);

alter table public.experiment_consent enable row level security;

create policy "Users can view own consent records"
  on public.experiment_consent for select
  using (auth.uid() = user_id);

create policy "Users can insert own consent records"
  on public.experiment_consent for insert
  with check (auth.uid() = user_id);

-- Disallow updates and deletes on consent table to guarantee append-only audit trail
-- (No update or delete policies defined).
