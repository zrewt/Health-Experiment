import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  authErrorMessage,
  deleteUserAccount,
  requestPasswordReset,
  signIn,
  signUp,
  updateUserPassword,
  validateCredentials,
} from '../src/lib/auth';

type AuthClient = Pick<SupabaseClient['auth'], 'signInWithPassword' | 'signUp'>;
const session = { access_token: 'test-only', user: { id: 'test-user' } };

function fixture(result: object, calls: unknown[] = []): AuthClient {
  const operation = async (credentials: unknown) => {
    calls.push(credentials);
    return result;
  };
  // The fixture intentionally implements only the SDK methods used by these helpers.
  return { signInWithPassword: operation, signUp: operation } as AuthClient;
}

test('validates email and passwords without rejecting shorter existing login passwords', () => {
  assert.ok(validateCredentials('invalid', 'password'));
  assert.ok(validateCredentials('name@example.com', ''));
  assert.ok(validateCredentials('name@example.com', 'short', true));
  assert.equal(validateCredentials('name@example.com', 'short'), null);
  assert.equal(validateCredentials(' name@example.com ', 'password', true), null);
});

test('login trims email and returns the SDK session without changing the password', async () => {
  const calls: unknown[] = [];
  const result = await signIn(fixture({ data: { session }, error: null }, calls), ' name@example.com ', ' password ');
  assert.equal(result, session);
  assert.deepEqual(calls, [{ email: 'name@example.com', password: ' password ' }]);
});

test('invalid input never calls the auth service', async () => {
  const calls: unknown[] = [];
  await assert.rejects(signUp(fixture({}, calls), 'bad', 'password'), /valid email/);
  await assert.rejects(signUp(fixture({}, calls), 'name@example.com', 'short'), /8 characters/);
  assert.equal(calls.length, 0);
});

test('auth service errors remain visible', async () => {
  const error = new Error('Invalid login credentials');
  await assert.rejects(signIn(fixture({ data: {}, error }), 'name@example.com', 'password'), /Invalid login/);
  await assert.rejects(signUp(fixture({ data: {}, error }), 'name@example.com', 'password'), /Invalid login/);
  assert.equal(authErrorMessage(error), error.message);
});

test('signup supports immediate sessions and email-confirmation-required responses', async () => {
  assert.equal(await signUp(fixture({ data: { session }, error: null }), 'name@example.com', 'password'), session);
  assert.equal(await signUp(fixture({ data: { session: null }, error: null }), 'name@example.com', 'password'), null);
});

test('login cannot silently succeed without a session', async () => {
  await assert.rejects(signIn(fixture({ data: { session: null }, error: null }), 'name@example.com', 'password'), /did not return a session/);
});

test('password recovery and update helpers validate inputs and surface errors', async () => {
  const resetCalls: string[] = [];
  const resetClient = {
    async resetPasswordForEmail(email: string) {
      resetCalls.push(email);
      return { data: {}, error: null } as any;
    },
  };
  await assert.rejects(requestPasswordReset(resetClient, 'not-an-email'), /valid email/);
  assert.equal(resetCalls.length, 0);
  await requestPasswordReset(resetClient, ' user@example.com ');
  assert.deepEqual(resetCalls, ['user@example.com']);

  const updateCalls: string[] = [];
  const updateClient = {
    async updateUser(attrs: { password?: string }) {
      updateCalls.push(attrs.password ?? '');
      return { data: { user: null }, error: null } as any;
    },
  };
  await assert.rejects(updateUserPassword(updateClient, 'short'), /8 characters/);
  assert.equal(updateCalls.length, 0);
  await updateUserPassword(updateClient, 'new-password-123');
  assert.deepEqual(updateCalls, ['new-password-123']);

  let rpcCalled = '';
  await deleteUserAccount({
    rpc(fn: string) {
      rpcCalled = fn;
      return Promise.resolve({ data: null, error: null }) as any;
    },
  });
  assert.equal(rpcCalled, 'delete_own_account');
});
