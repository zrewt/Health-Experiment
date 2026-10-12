-- PROVIDED AS TEXT ONLY. NOT EXECUTED.
-- Apply after supabase/schema.sql, using your normal database review process.

alter table public.experiment_setup
  add column if not exists next_check_date date;

create table public.experiment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan jsonb not null,
  status text not null default 'scheduled',
  created_at timestamptz default now()
);

alter table public.experiment_plans enable row level security;

create policy "Users can view own experiment plans"
  on public.experiment_plans for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own experiment plans"
  on public.experiment_plans for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own experiment plans"
  on public.experiment_plans for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create unique index uq_experiment_plans_non_cancelled_user
  on public.experiment_plans (user_id)
  where status <> 'cancelled';

-- No delete policy. Deletion is only via the auth.users foreign-key cascade.
