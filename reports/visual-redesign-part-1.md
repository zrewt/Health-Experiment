# Visual redesign, part 1: foundations, Home, Daily, Result

Light, calm, premium pass over the shared UI. Copy, logic, navigation and data are
unchanged; the only text touched is all-caps label casing (see "Copy and words").

## 1. Inventory (design values outside `src/design/tokens.ts`)

65 files before, 68 after. Counted per property site, so a value read from a token is
not counted as hard-coded.

| | before (HEAD) | after |
|---|---|---|
| raw hex / rgb colour literal | 1 | 1 |
| `fontSize` number | 1 | 1 |
| `lineHeight` number | 4 | 4 |
| `borderRadius` number | 4 | 5 |
| shadow object / `elevation` | 0 | 0 |
| numeric `padding` / `margin` / `gap` | 17 | 13 |

The one hex literal is a doc comment in `src/components/ui/Field.tsx`; there is no
colour written by hand outside the token file, and no shadow anywhere in the app.

Ten worst files before the pass (count of the values above):

```
 8  src/components/ui/AccountSetupNotice.tsx
 6  src/app/journal.tsx
 2  src/app/experiment.tsx
 2  src/components/CheckInCard.tsx
 1  src/app/feasibility.tsx
 1  src/app/reminder-settings.tsx
 1  src/app/result.tsx
 1  src/app/setup-consent.tsx
 1  src/components/ui/Disclosure.tsx
 1  src/components/ui/NavRow.tsx
```

The drift in this app was never literal values: it was palette *semantics*. Everything
read a dark token (`ground`, `ivory`, `champagne`), so the whole UI was dark by
definition. The remaining numeric values live in screens part 2 will rebuild.

## 2. Contrast (WCAG 2.1, `node scripts/contrast-sanity.cjs`)

Required: 4.5:1 body text, 3:1 large text and UI parts.

| pair | ratio | need |
|---|---|---|
| text on background | 13.98 | 4.5 |
| text on surface | 15.10 | 4.5 |
| text on surfaceTint | 13.13 | 4.5 |
| textMuted on background | 5.62 | 4.5 |
| textMuted on surface | 6.07 | 4.5 |
| textMuted on surfaceTint | 5.28 | 4.5 |
| accent on background | 5.02 | 4.5 |
| accent on surface | 5.42 | 4.5 |
| accent on surfaceTint | 4.72 | 4.5 |
| surface on text (primary button label) | 15.10 | 4.5 |
| text on graphic (label over a mint chip) | 9.58 | 4.5 |
| signalText on surface (error text) | 5.99 | 4.5 |
| signalText on background (error text) | 5.55 | 4.5 |
| signalText on surface (error border) | 5.99 | 3 |
| accent on background (focus ring) | 5.02 | 3 |
| accent on surface (focus ring) | 5.42 | 3 |
| lineStrong on background (input border) | 3.18 | 3 |
| lineStrong on surface (input border) | 3.44 | 3 |
| graphic on text (mint half against the ink half) | 9.58 | 3 |
| signal on text (coral half against the ink half) | 6.54 | 3 |

Two deliberate exclusions, both fills that never carry meaning alone: Mint is 1.46:1
and Coral 2.14:1 against the background, so neither is ever text or a lone cue — the
cutoff day always carries the words "Cutoff day" beside the disc.

Hexes changed from the brief, because the brief's values failed:

- `Ink soft` `#51666A` → kept: 5.62:1 on Mist passes.
- `Lagoon` `#12776A` → kept: 5.02:1 on Mist, 4.72:1 on the tint passes 4.5.
- Error text is a new token, `signalText` `#A8432C`: Coral itself is 2.14:1, so error
  text and error borders use this darker coral and Coral stays a graphic.
- Input borders use `lineStrong` `#788F8C` (3.18:1). The brief's "hairline borders only
  on inputs" needs a border that is visible at 3:1, so this is the only border in the
  app outside the danger surface.

## 3. Design plan

Tokens — semantic names first, legacy names kept as aliases onto the same light values
until every screen is migrated: `background` Mist `#F3F7F6`, `surface` Paper `#FFFFFF`,
`surfaceTint` `#E8F1EF`, `text` Ink `#0F2A2E`, `textMuted` Ink soft `#51666A`, `accent`
Lagoon `#12776A`, `graphic` Mint `#7DE0C3`, `signal` Coral `#FF8A6B`, `signalText`
`#A8432C`, `line`, `lineStrong`, `focus`, `overlay`. Aliases: `ground`, `ivory`,
`champagne`, `hairline`, `garnet`, `surfaceHigh`, `surfaceGlass`, `ivoryMuted`, and the
rest of the old type scale.

Type scale — system stack only, one step per role: display 40/44, title 28/34, heading
20/26, body 17/24, caption 13/18. Weights 400/500/600. Letter spacing −0.6 on display,
−0.2 on title, 0 elsewhere. No serif, no extra font files: nothing is loaded before the
first paint, and every size reflows at the largest device text size.

Spacing 4 / 8 / 12 / 16 / 24 / 32 / 48, screen gutter 24, surface padding 24, gap
between top-level blocks 32. Radii: 14 for controls, 20 for surfaces, plus pills. No
shadow anywhere, no gradient.

Disc geometry — two half-discs of one circle, 88 pt on Home and 96 pt on Daily. The
bottom half is always Ink. The top half is Mint on a normal day, Coral on a cutoff day,
`surfaceTint` when today is not a test day, and it sits 22% of the diameter to the right,
so the seam is visibly out of line. Because the bottom half is Ink at every tone, the
mark reads in greyscale; the type is also written in words beside it. One settle
animation on mount (320 ms, opacity plus a small drift into place), skipped entirely
when the device asks for reduced motion.

Against the AVOID list and the generic defaults: one surface radius and no shadow, so
cards are surfaces separated by tone and whitespace rather than identical boxes;
borders appear only on inputs and the danger surface; no gradient wash; no all-caps
eyebrow (domain strings in capitals are rendered sentence case); no middle-dot meta
strings on the three rebuilt screens; no arrows on buttons; no accent word inside a
headline; no fade-in per section. Not cream + serif + terracotta, not near-black + acid
accent, and not a stack of identical rounded cards.

## 4. Components rebuilt

`Screen` (Mist, 24 pt gutter, safe areas, 620 pt measure cap), `Text` (semantic variants
and colours, legacy names mapped), `Button` (one Ink primary, tint secondary, quiet text
action; 54 pt tall, no border, no arrow), `Card`/`Surface` (default, hero, tint, quiet,
danger — no border but on danger), `Field` (the only bordered control, focus ring in
Lagoon), `Banner` (new: error and notice tones, one action), `SplitDisc` (new),
`Row`, `ScreenHeader`, `NavRow`, `Disclosure`/`Details`, `PrimaryNav`.

## 5. Screens rebuilt

- Home: status line and date, the disc with today's type in words, one headline from the
  engine, one supporting line, the primary action in the thumb zone, quiet text actions
  below. Check-in card collapsed to a single summary line until tapped.
- Daily instruction: "Day X of Y" with a Menu button, the 96 pt disc, today's type at
  title size with the rest of the rule underneath, one log button at the bottom.
- Result: headline, "How sure we are" with its one line, "What to do next", details
  collapsed by default, days list quiet.

## 6. Other screens

Every other screen still reads through the legacy aliases, which now resolve to the light
values, so nothing is light-on-light and no dark leftover remains: `setup-consent`,
`run-in`, `feasibility`, `journal`, `experiment`, `settings`, `reminder-settings`,
`dev-tools`, `AuthForm`, `AccountSetupNotice`, `CheckInCard`. They keep their existing
layout and get polished in part 2.

## 7. Accessibility

Buttons and rows carry labels (the disc is decorative and hidden from screen readers,
the type beside it is not); the cutoff day is never colour alone; the mount animation is
skipped under reduced motion; text uses the system stack with a per-step line height, so
the largest device text size reflows rather than clips; contrast is asserted in
`scripts/contrast-sanity.cjs`.

## 8. Copy and words

No new words were needed. Two changes are case only, and both are required by the brief's
ban on all-caps labels:

- Screen-owned overlines are sentence case: `WHAT WE FOUND` → "What we found" (result),
  `PROGRESS`, `TEST`, `ENDED`, `LAST NIGHT` and the rest render through
  `src/design/labels.ts`, which only changes the case of a string the domain already
  wrote — it never adds, drops or rewrites a word.
- "Last night ({date})" replaces the overline form of the same label on the check-in
  card; the words and the date are unchanged.

## 9. Tests

No test file was edited: the styling and copy assertions in `scripts/screen3.test.ts`,
`scripts/screen4.test.ts`, `scripts/screen5.test.ts`, `scripts/home-state.test.ts` and
`scripts/domain-screens.test.ts` all still pass unchanged. `scripts/contrast-sanity.cjs`
was repointed at the new palette and now asserts 20 pairs instead of the old dark ones.

## 10. Verification

- `npx expo lint` — clean.
- `npx tsc --noEmit` — clean.
- `npx tsc -p tsconfig.engine.json --noEmit` — clean.
- `npx tsx --test scripts/*.test.ts` — 180 pass, 0 fail.
- `npm run verify:freeze` — 10 files match the SHA-256 manifest, 0 mismatches.
- `npm run test:env`, `npm run test:auth` — pass.
- Rendered in the real app (Expo web, 390×844, `/auth/sign-in`): Mist background fills
  the viewport, Paper surfaces, Ink title at 32 px/600, Ink soft secondary at 17 px, the
  primary button white on Ink, Lagoon on the quiet actions, one input border, no app
  shadow, no console error. The three redesigned screens sit behind sign-in and were not
  rendered here.

ENGINE: verify:freeze clean — 10 files match the SHA-256 manifest, 0 mismatches.
TESTS: 180 tests, 180 pass, 0 fail.
NOT VERIFIED: Home, Daily and Result were not rendered in a browser (they need a signed-in session I do not have); no phone, tablet, screen reader, or dynamic-type run was made.
PHONE TEST: Home, then the Daily instruction, then Result — check the disc's offset seam reads in greyscale, the primary button sits low under the thumb, and nothing clips at the largest text size.
