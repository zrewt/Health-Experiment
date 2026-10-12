-- PROVIDED AS TEXT ONLY. NOT EXECUTED.
-- Apply after schema-screen3.sql, using your normal database review process.

-- Additive column for dev sample experiment entries
alter table public.experiment_entries
  add column if not exists is_sample boolean not null default false;

-- Permit users to delete only their own sample entries
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'experiment_entries' and policyname = 'Users can delete own sample entries'
  ) then
    create policy "Users can delete own sample entries"
      on public.experiment_entries for delete
      using (auth.uid() = user_id and is_sample = true);
  end if;
end $$;
