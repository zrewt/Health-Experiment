import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { deviceKeysForUser } from '../src/data/local-wipe';
import { deleteUserAccount } from '../src/lib/auth';

/** Keys a signed-in phone can hold: one account's caches, another account, and device settings. */
const DEVICE_KEYS = [
  '@experiment_setup:user-1',
  '@experiment_entries:user-1',
  '@experiment_consent:user-1',
  '@experiment_plans_history:user-1',
  '@experiment_archived_plan_ids:user-1',
  '@experiment_active_plan:user-1',
  '@experiment_pending_plan:user-1',
  // A cache key this build does not name: the sweep finds it by shape, not by a list.
  '@experiment_added_by_a_later_screen:user-1',
  '@experiment_entries:user-2',
  // Device-level, not account data: reminder preferences and the session itself.
  'aevum-reminder-preferences-v1',
  'sb-someproject-auth-token',
];

test('clearing a device takes every cache of that account, and nothing else', () => {
  const removed = deviceKeysForUser(DEVICE_KEYS, 'user-1');
  assert.deepEqual(removed, [
    '@experiment_setup:user-1',
    '@experiment_entries:user-1',
    '@experiment_consent:user-1',
    '@experiment_plans_history:user-1',
    '@experiment_archived_plan_ids:user-1',
    '@experiment_active_plan:user-1',
    '@experiment_pending_plan:user-1',
    '@experiment_added_by_a_later_screen:user-1',
  ]);
  // Another account's offline copy on the same phone is never touched.
  assert.deepEqual(deviceKeysForUser(DEVICE_KEYS, 'user-2'), ['@experiment_entries:user-2']);
  // Device settings and the session survive: reminders keep working, sign-out owns the token.
  const removedForOne = deviceKeysForUser(DEVICE_KEYS, 'user-1');
  assert.equal(removedForOne.includes('aevum-reminder-preferences-v1'), false);
  assert.equal(removedForOne.includes('sb-someproject-auth-token'), false);
});

test('an empty user id clears nothing, and a foreign key that merely ends in the id is ignored', () => {
  assert.deepEqual(deviceKeysForUser(DEVICE_KEYS, ''), []);
  assert.deepEqual(deviceKeysForUser(['other_store:user-1', '@experiment_entries:user-1'], 'user-1'), [
    '@experiment_entries:user-1',
  ]);
});

test('account deletion calls the server routine and reports a refusal with its code', async () => {
  const calls: string[] = [];
  await deleteUserAccount({
    rpc(fn: string) {
      calls.push(fn);
      return Promise.resolve({ data: null, error: null }) as never;
    },
  });
  assert.deepEqual(calls, ['delete_own_account']);

  await assert.rejects(
    deleteUserAccount({
      rpc() {
        return Promise.resolve({
          data: null,
          error: { message: 'permission denied for function delete_own_account', code: '42501' },
        }) as never;
      },
    }),
    /permission denied for function delete_own_account \(42501\)/,
  );
});

test('the schema lets account deletion through the locked-day rule', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'schema-all.sql'), 'utf8');
  const lock = sql.slice(sql.indexOf('create or replace function public.check_entry_edit_lock()'));
  const wipe = sql.slice(sql.indexOf('create or replace function public.delete_own_account()'));

  // Without the flag the trigger refuses to delete entries under a completed plan, which is
  // exactly what account deletion has to remove, so the two halves must stay paired.
  assert.match(lock, /current_setting\('aevum\.account_delete', true\)/);
  assert.match(wipe, /set_config\('aevum\.account_delete', 'on', true\)/);
  // Sample rows are dev scaffolding: the lock must not block the dev tool that removes them.
  assert.match(lock, /OLD\.is_sample/);
  // The rows go before the account row, so the cascade order cannot matter.
  assert.ok(
    wipe.indexOf('delete from public.experiment_entries') < wipe.indexOf('delete from auth.users'),
    'account deletion must delete the rows before the account row',
  );
});
