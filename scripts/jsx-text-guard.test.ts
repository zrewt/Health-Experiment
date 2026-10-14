import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * React Native throws "Text strings must be rendered within a <Text> component" for any
 * string child of a View. Whitespace between two tags on the same line is exactly that: a
 * text node, not layout. It is invisible in the source and only shows up on a device, so
 * one stray indent once crashed the whole check-in card.
 *
 * A guard rather than a lint rule: the scan needs no configuration, and the check runs with
 * the rest of the suite.
 */

const ROOT = path.join(process.cwd(), 'src');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** `</View>   <Text>` and `<View />  </View>` are the shapes that produce a text child. */
const BETWEEN_TAGS = /(?<=[>])\s+(?=<[A-Za-z/])/;

test('no JSX whitespace text nodes between tags on one line', () => {
  const offenders: string[] = [];
  for (const file of tsxFiles(ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      // Spaces or tabs only: a newline between tags is trimmed away by JSX and is fine.
      if (BETWEEN_TAGS.test(line)) {
        offenders.push(`${path.relative(process.cwd(), file).split(path.sep).join('/')}:${index + 1}  ${trimmed}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `whitespace between tags becomes a string child and crashes React Native:\n${offenders.join('\n')}`,
  );
});
