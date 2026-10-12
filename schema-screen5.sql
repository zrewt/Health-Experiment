-- PROVIDED AS TEXT ONLY. NOT EXECUTED.
-- Apply after schema-screen4.sql, using your normal database review process.

-- Add result snapshot and completion timestamp to experiment_plans
alter table public.experiment_plans
  add column if not exists result jsonb,
  add column if not exists completed_at timestamptz;

-- Add check constraint for status values safely
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
