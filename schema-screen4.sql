-- PROVIDED AS TEXT ONLY. NOT EXECUTED.
-- Apply after schema-screen3.sql, using your normal database review process.

-- Additive column for dev sample experiment entries
alter table public.experiment_entries
  add column if not exists is_sample boolean not null default false;

-- Permit users to delete only their own sample entries
create policy "Users can delete own sample entries"
  on public.experiment_entries for delete
  using (auth.uid() = user_id and is_sample = true);
