-- PROVIDED AS TEXT ONLY. NOT EXECUTED.
-- Apply after schema-screen6.sql, using your normal database review process.

-- ============================================================================
-- 1. Support repeating experiments while preserving completed plan history
-- ============================================================================
-- Replaces the partial unique index that blocked additional plans after a
-- 'completed' row with a partial unique index on status = 'scheduled' only.
-- Existing completed plans remain in public.experiment_plans and their
-- scheduled dates remain locked by trg_prevent_completed_entry_edits.
-- ============================================================================

drop index if exists public.uq_experiment_plans_non_cancelled_user;

create unique index if not exists uq_experiment_plans_scheduled_user
  on public.experiment_plans (user_id)
  where status = 'scheduled';

-- ============================================================================
-- 2. In-app account deletion RPC (App Store requirement)
-- ============================================================================
-- Deletes the authenticated caller's auth.users row, cascading to
-- experiment_consent, experiment_setup, experiment_entries, and experiment_plans.
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

  delete from auth.users
  where id = caller_id;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
