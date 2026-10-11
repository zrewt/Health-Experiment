const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/env.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const publicKey = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64url'),
  'test-signature-not-a-real-key',
].join('.');

function load(environment) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, process: { env: environment }, URL, atob, console,
  }, { filename: 'env.ts' });
  return exports;
}

for (const environment of [
  {},
  {
    EXPO_PUBLIC_SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
    EXPO_PUBLIC_APP_ENV: 'development',
  },
]) {
  const result = load(environment);
  assert.equal(result.isSupabaseConfigured, false);
  assert.equal(result.env.supabaseUrl, null);
  assert.equal(result.env.supabaseAnonKey, null);
  assert.ok(result.environmentIssues.some((i) => i.variable === 'EXPO_PUBLIC_SUPABASE_URL'));
  assert.ok(result.environmentIssues.some((i) => i.variable === 'EXPO_PUBLIC_SUPABASE_ANON_KEY'));
  assert.ok(typeof result.environmentHint === 'string' && result.environmentHint.length > 0);
  assert.ok(Array.isArray(result.environmentFixSteps) && result.environmentFixSteps.length >= 2);
}

// The hint must separate "nothing reached the bundle" (a stale dev server, since
// Expo inlines EXPO_PUBLIC_* at startup) from "values arrived but were rejected".
assert.match(load({}).environmentHint, /bundle/i);
assert.match(
  load({
    EXPO_PUBLIC_SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  }).environmentHint,
  /rejected/i
);

const moduleExports = load({});
const validate = moduleExports.validateEnv;
const ready = validate({
  supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: publicKey, appEnv: 'production',
});
assert.equal(ready.isSupabaseConfigured, true);
assert.equal(ready.env.appEnv, 'production');
assert.equal(ready.issues.length, 0);
assert.equal(validate({
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'sb_publishable_synthetic-test-key', appEnv: 'preview',
}).isSupabaseConfigured, true);
for (const url of ['not a url', 'http://example.supabase.co', 'https://user:pass@example.com', 'https://example.com/path']) {
  assert.equal(validate({ supabaseUrl: url, supabaseAnonKey: publicKey }).isSupabaseConfigured, false);
}
const serverKey = `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`;
for (const key of ['sb_secret_synthetic', serverKey, 'invalid', 'a.b.c']) {
  assert.equal(validate({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: key }).isSupabaseConfigured, false);
}
assert.equal(validate({ appEnv: 'invalid' }).env.appEnv, 'development');
assert.ok(validate({ appEnv: 'invalid' }).issues.some((i) => i.variable === 'EXPO_PUBLIC_APP_ENV'));
console.log('Environment sanity passed: missing, placeholder, configured, malformed, and server-key rejection states.');
