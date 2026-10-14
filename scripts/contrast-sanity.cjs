const assert = require('node:assert/strict');

/**
 * Contrast check for the light redesign palette.
 *
 * Mirrors the values in src/design/tokens.ts (this file is CJS and cannot import the
 * TypeScript tokens module), so keep the two in step. Run: node scripts/contrast-sanity.cjs
 *
 * Required: 4.5:1 for body text, 3:1 for large text and UI parts (WCAG 2.1 AA).
 */
const colors = {
  background: '#F3F7F6', // Mist
  surface: '#FFFFFF', // Paper
  surfaceTint: '#E8F1EF',
  text: '#0F2A2E', // Ink
  textMuted: '#51666A', // Ink soft
  accent: '#12776A', // Lagoon
  graphic: '#7DE0C3', // Mint: fills and graphics only
  signal: '#FF8A6B', // Coral: cutoff graphic only, always with a text label
  signalText: '#A8432C',
  lineStrong: '#788F8C', // input borders only
  line: '#E4ECEB',
};

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [num >> 16, (num >> 8) & 255, num & 255];
}

function luminance([r, g, b]) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function contrast(hex1, hex2) {
  const lum1 = luminance(hexToRgb(hex1));
  const lum2 = luminance(hexToRgb(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

/** [label, foreground, background, minimum] */
const pairs = [
  ['text on background', 'text', 'background', 4.5],
  ['text on surface', 'text', 'surface', 4.5],
  ['text on surfaceTint', 'text', 'surfaceTint', 4.5],
  ['textMuted on background', 'textMuted', 'background', 4.5],
  ['textMuted on surface', 'textMuted', 'surface', 4.5],
  ['textMuted on surfaceTint', 'textMuted', 'surfaceTint', 4.5],
  ['accent on background', 'accent', 'background', 4.5],
  ['accent on surface', 'accent', 'surface', 4.5],
  ['accent on surfaceTint', 'accent', 'surfaceTint', 4.5],
  ['surface on text (primary button label)', 'surface', 'text', 4.5],
  ['text on graphic (label over a mint chip)', 'text', 'graphic', 4.5],
  ['signalText on surface (error text)', 'signalText', 'surface', 4.5],
  ['signalText on background (error text)', 'signalText', 'background', 4.5],
  ['signalText on surface (error border, UI)', 'signalText', 'surface', 3],
  ['accent on background (focus ring, UI)', 'accent', 'background', 3],
  ['accent on surface (focus ring, UI)', 'accent', 'surface', 3],
  ['lineStrong on background (input border, UI)', 'lineStrong', 'background', 3],
  ['lineStrong on surface (input border, UI)', 'lineStrong', 'surface', 3],
  ['graphic on text (disc half against the ink half)', 'graphic', 'text', 3],
  ['signal on text (disc half against the ink half)', 'signal', 'text', 3],
];

let failures = 0;
for (const [label, fg, bg, minimum] of pairs) {
  const ratio = contrast(colors[fg], colors[bg]);
  const ok = ratio >= minimum;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2)}:1  need ${minimum}  ${label}`,
  );
  assert.ok(ok, `${label} must be at least ${minimum}:1 (got ${ratio.toFixed(2)}:1)`);
}

// Mint and Coral are fills and graphics only: they sit at 1.46:1 and 2.14:1 against the
// background and are never the sole carrier of meaning (today's type always carries a
// text label), so they are deliberately excluded from the checks above.
const graphicOnBackground = contrast(colors.graphic, colors.background).toFixed(2);
const signalOnBackground = contrast(colors.signal, colors.background).toFixed(2);
console.log(
  `NOTE  ${graphicOnBackground}:1 graphic on background and ${signalOnBackground}:1 signal on background — fills only, never a text or a lone cue.`,
);

assert.equal(failures, 0, `${failures} contrast pair(s) below the required ratio`);
console.log(`All ${pairs.length} contrast pairs passed.`);
