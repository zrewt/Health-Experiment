-- Additive SQL draft. NOT executed by the app or by this task -- apply manually.
--
-- Enforces the shape of the stored last-caffeine time for NEW and UPDATED rows
-- WITHOUT validating existing rows ("NOT VALID"), so legacy rows never block it.
--
-- Allowed stored values:
--   * a strict 24-hour "HH:mm" time (two-digit hour 00-23, two-digit minute 00-59)
--   * the literal 'none' (explicitly no caffeine)
--   * NULL (skipped / unknown)
-- Single-digit hours such as '9:30' are intentionally NOT allowed (never padded).
--
-- Caution: the offline retry queue re-writes already-stored values verbatim, so a
-- legacy malformed row would fail to re-sync while this constraint is enforced.
-- That is why it is drafted, not applied.

alter table public.experiment_entries
  add constraint experiment_entries_last_caffeine_time_check
  check (
    last_caffeine_time is null
    or last_caffeine_time = 'none'
    or last_caffeine_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ) not valid;
