import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { getToday, __setDevClockOffset } from '../src/experiment/clock';

/** Today's local calendar date, computed the same way getToday() does without the dev shift. */
function localToday(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Run `fn` with global __DEV__ forced to the given value, then restore the real environment. */
function withDev(value: boolean | undefined, fn: () => void): void {
  const globalRef = globalThis as { __DEV__?: boolean };
  const had = Object.prototype.hasOwnProperty.call(globalThis, '__DEV__');
  const previous = globalRef.__DEV__;
  if (value === undefined) delete globalRef.__DEV__;
  else globalRef.__DEV__ = value;
  try {
    fn();
  } finally {
    __setDevClockOffset(0);
    if (had) globalRef.__DEV__ = previous;
    else delete globalRef.__DEV__;
  }
}

test('dev clock guard fails closed: the offset applies only when __DEV__ is strictly true', () => {
  withDev(true, () => {
    __setDevClockOffset(5);
    assert.notEqual(getToday(), localToday());
  });
  withDev(false, () => {
    __setDevClockOffset(5);
    assert.equal(getToday(), localToday());
  });
  withDev(undefined, () => {
    __setDevClockOffset(5);
    assert.equal(getToday(), localToday());
  });
});

test('dev-tools screen fails closed and no fail-open __DEV__ guard remains in src', () => {
  const devTools = fs.readFileSync(path.resolve(__dirname, '../src/app/dev-tools.tsx'), 'utf8');
  assert.match(devTools, /__DEV__\s*!==\s*true/, 'dev-tools must require __DEV__ to be strictly true');
  assert.match(devTools, /Redirect\s+href="\/"/, 'dev-tools must redirect away when not dev');

  const srcDir = path.resolve(__dirname, '../src');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const text = fs.readFileSync(full, 'utf8');
      // The historical fail-open shape: a dev check that never rejects the unknown case.
      if (/&&\s*!\s*__DEV__/.test(text)) offenders.push(path.relative(srcDir, full));
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, [], 'no source file may gate dev content with the fail-open "&& !__DEV__" shape');
});
