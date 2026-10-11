const assert = require('node:assert/strict');

// WCAG contrast calculation
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

const colors = {
  ground: '#080F0B',
  surface: '#0F1A14',
  surfaceHigh: '#15241C',
  hairline: '#1B2C22',
  ivory: '#F7F4EB',
  ivoryMuted: '#849688',
  champagne: '#D9C187',
  garnet: '#C4574C',
};

// Test ivory on ground
const ivoryOnGround = contrast(colors.ivory, colors.ground);
console.log('Contrast ivory on ground:', ivoryOnGround.toFixed(2));
assert.ok(ivoryOnGround >= 4.5, 'Ivory on ground must be >= 4.5 (WCAG AA)');

// Test champagne on ground
const champagneOnGround = contrast(colors.champagne, colors.ground);
console.log('Contrast champagne on ground:', champagneOnGround.toFixed(2));
assert.ok(champagneOnGround >= 4.5, 'Champagne on ground must be >= 4.5');

// Test ground text inside primary champagne button
const groundOnChampagne = contrast(colors.ground, colors.champagne);
console.log('Contrast ground text on champagne button:', groundOnChampagne.toFixed(2));
assert.ok(groundOnChampagne >= 4.5, 'Ground text on champagne button must be >= 4.5');

// Test ivoryMuted on ground (minimum 3:1 for large/secondary or UI elements)
const mutedOnGround = contrast(colors.ivoryMuted, colors.ground);
console.log('Contrast ivoryMuted on ground:', mutedOnGround.toFixed(2));
assert.ok(mutedOnGround >= 3.0, 'Muted on ground must be >= 3.0');

console.log('All contrast tests passed.');
