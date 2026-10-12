-- PROVIDED AS TEXT ONLY. NOT EXECUTED.
-- Apply after schema-screen5.sql, using your normal database review process.

-- ============================================================================
-- Server-side edit lock enforcement for completed experiments
-- ============================================================================
-- Prevents modifying (UPDATE) or deleting (DELETE) entries that fall within the
-- scheduled dates of any completed experiment plan for that user.
--
-- Guarantees:
-- 1. Entries within a completed plan's schedule (including day E) cannot be updated.
-- 2. Entries within a completed plan's schedule cannot be deleted.
-- 3. Entries outside the completed plan's schedule (or for cancelled/scheduled plans)
--    remain editable subject to ordinary RLS policies.
-- 4. Dev sample entry deletion for uncompleted plans continues to work.
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
  if (TG_OP = 'DELETE') then
    target_user_id := OLD.user_id;
    target_date := OLD.date;
  else
    target_user_id := NEW.user_id;
    target_date := NEW.date;
  end if;

  -- Check if any completed plan for this user contains target_date in its schedule
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

-- Drop trigger if already exists so script is safely idempotent
drop trigger if exists trg_prevent_completed_entry_edits on public.experiment_entries;

create trigger trg_prevent_completed_entry_edits
  before update or delete
  on public.experiment_entries
  for each row
  execute function public.check_entry_edit_lock();
