/**
 * Which device-local keys belong to one account.
 *
 * Every key the app writes for a user looks like `@experiment_<thing>:<userId>`, so the
 * offline copy of an account is found by shape rather than by a hand-kept list of names:
 * a cache added by a later screen is cleared by this rule too, and another account's copy
 * on the same device is never touched.
 *
 * Kept separate from the storage call so the rule itself can be tested.
 */

/** Prefix every per-user device key shares. */
export const USER_KEY_PREFIX = '@experiment_';

/** The suffix that ties a key to one account. */
export function userKeySuffix(userId: string): string {
  return `:${userId}`;
}

export function deviceKeysForUser(allKeys: readonly string[], userId: string): string[] {
  // No id, no keys: an empty id would end in ':' and could match an unrelated key.
  if (!userId) return [];
  const suffix = userKeySuffix(userId);
  return allKeys.filter((key) => key.startsWith(USER_KEY_PREFIX) && key.endsWith(suffix));
}
