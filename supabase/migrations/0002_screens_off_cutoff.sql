-- 0002: screens-off cutoff test.
--
-- Adds one nullable column for last screen use ('HH:MM' | 'none' | null). Existing rows get
-- null, which means "not logged" for the screens test and never counts as screens-on or off.
-- The locked-day trigger and RLS policies already cover every column of these rows, so they
-- need no change. Safe to run more than once.

alter table public.experiment_entries
  add column if not exists last_screen_time text;
