# Aevum — project report and what to build next

Written after the light-redesign pass, the account-deletion fixes and the check-in crash fix.
Everything below was read or run against this checkout; anything not verified says so.

## 1. Snapshot

| | |
|---|---|
| What it is | A personal sleep-test app. You cut caffeine on some mornings, keep sleeping normally on others, log a one-tap check-in each day, and the app works out whether the cutoff did anything for you. |
| Stack | Expo SDK 57, React Native 0.86, React 19, TypeScript, Expo Router, Zustand, Supabase (auth + Postgres), AsyncStorage, expo-notifications, Reanimated. |
| Size | 12,071 lines of TypeScript across `src/` (70 files), 13 routes, 9 engine files, 185 tests. |
| Version | `0.1.0`, name "Aevum", scheme `aevum`. No store build has been made yet. |
| Verified state | lint, typecheck, engine typecheck, 185/185 tests, `verify:freeze` all clean. Uncommitted work in the working tree (see §9). |
| Not verified | No run on a physical device or simulator by me; the three redesigned screens have only been rendered on the phone by hand. |

## 2. How the app is built

```
src/app/            routes (every file is a screen)
  auth/             sign-in, sign-up
src/components/     AuthForm + CheckInCard (the two big shared pieces)
  ui/               the design system: Screen, Text, Button, Card/Surface, Field, Banner,
                    Row/StatStrip, NavRow, ScreenHeader, Disclosure/Details, PrimaryNav, SplitDisc
src/design/         tokens.ts (the only colour file), labels.ts (label casing only)
src/experiment/     the app's domain layer: adapters, lifecycle, today-dashboard, journal,
                    start-attempt, feasibility gate, dates, clock, caffeine-time parsing
src/engine/         the statistics: schedule generation, analysis, verdict, feasibility
                    → frozen, hash-verified, never edited by a screen
src/data/           Supabase + AsyncStorage persistence, pending-entry retry, local wipe
src/notifications/  reminder plan, scheduling, tap routing, preferences, tap handler
src/store/          auth store (session mirroring)
src/lib/            supabase client, env parsing, auth helpers
src/dev/            sample-data loader (dev only)
```

The one hard rule that shapes everything: **`src/engine/` is frozen**. Engineering changes are
checksum-verified against a manifest (`npm run verify:freeze`), and the app may only reach the
engine through `src/experiment/`. Any statistical change is therefore a deliberate, documented
re-freeze, not an edit.

## 3. What the app does today, screen by screen

| Route | Job | State |
|---|---|---|
| `/auth/sign-in`, `/auth/sign-up` | Email + password, reset email, confirmation-required signup handled | Working, not yet in the light redesign (part 2) |
| `/setup-consent` | Cutoff time, four-bullet consent summary, separate agree step, full text under Details | Working; **its legal text is a draft** and says so in the source |
| `/run-in` | "Getting to know your sleep": baseline days, eligibility, check-in card | Working, part 2 pending |
| `/feasibility` | "Is this test worth doing?": one plain verdict, one reason, numbers under Details | Working, part 2 pending |
| `/` (Home) | Today's status, the split disc, one headline, primary action, check-in collapsed to a line | **Redesigned** (part 1) |
| `/daily-instruction` | "Day X of Y", the 96 pt disc, today's type, the log card, End early in a menu | **Redesigned** (part 1) |
| `/result` | What we found, How sure we are, What to do next, details collapsed, days list | **Redesigned** (part 1) |
| `/journal` | The full log, a per-day chart with accessible summaries, edit windows | Working, part 2 pending |
| `/experiment` | Past tests, lifecycle guide, start a new cycle | Working, part 2 pending |
| `/settings` | Reminders status, account (password, reset, sign out), data explanation, clear device, delete account | Working; the delete flows were repaired in this session |
| `/reminder-settings` | Daily reminders, before-the-cutoff nudge, evening heads-up | Working; needs a development build to be tested for real |
| `/dev-tools` | Sample data loader, clock jump to E+1, reset completed plan — `__DEV__` only, fails closed | Working |

## 4. Data, accounts and privacy

- **Server:** Supabase Postgres, four tables — `experiment_setup`, `experiment_entries`,
  `experiment_consent` (append-only), `experiment_plans` (jsonb plan + stored result snapshot).
  Every table is RLS-protected by `auth.uid() = user_id`, every FK cascades from `auth.users`.
- **A locked-day trigger** refuses edits and deletes of entries inside a completed test's
  schedule, so a saved verdict always matches the log it came from.
- **Account deletion:** `delete_own_account()` (security definer) removes the user's rows and
  then the account. This is what actually makes deletion work on a completed test — before this
  session's fix the trigger refused it.
- **Device:** every per-user key is `@experiment_<thing>:<userId>` in AsyncStorage; entries that
  fail to sync stay flagged `synced: false` and retry, so missing data is never zero-filled.
- **Left alone intentionally:** reminder preferences are device-level, and the session token
  belongs to sign-out, not to the "clear this device" button.
- **Not built yet:** data export, email change, retention/consent version history surfaced to the
  user, and a hosted privacy policy. The consent copy is explicitly a draft awaiting legal review.

## 5. Reminders

Local notifications only (no push service): a small day-aware queue, rebuilt on each home visit,
cancelled on terminal states, with tap routing into the right screen and a settings screen for
the three slots. `expo-notifications` in Expo Go cannot be validated — reminder behaviour needs a
development build, which is why the console keeps warning about it.

## 6. Design system

- One token file, semantic names first (`background`, `surface`, `text`, `textMuted`, `accent`,
  `graphic`, `signal`, `lineStrong`, …) with the old names kept as aliases until part 2 finishes.
- Light palette: Mist background, Paper surfaces, Ink text, Lagoon accent, Mint and Coral as
  graphics only. 20 contrast pairs asserted in `scripts/contrast-sanity.cjs`.
- Type: system fonts only, one step per role (display 40, title 28, heading 20, body 17,
  caption 13). Spacing 4/8/12/16/24/32/48, radii 14 and 20, no shadows anywhere.
- Signature: the offset split circle on Home and Daily, plain Views, one settle animation that
  respects reduced motion, readable in greyscale with a text label beside it.
- **Part 1 is done** (foundations + Home, Daily, Result). **Part 2 is not**: the other ten routes
  still read through legacy aliases and need their layouts polished, after which the aliases can
  be deleted.

## 7. Copy and wording

`AGENT_RULES.md` holds the app's plain-words brief (one idea per screen, ~25 visible words,
banned jargon list, daily screen is one big line, engine sentences stay verbatim, nothing may
sound medical). That pass has been applied; the redesign only changed capitalisation
(all-caps labels became sentence case) and added no new words.

## 8. Engine and science

`src/engine/` v3: seeded schedule generation with weekend balance, eligibility checks, a
studentized circular moving-block bootstrap interval, three verdict policies (A default, B
label-only, C hard), a descriptive attenuation flag, and an analytic AR(1) feasibility estimate.
Missing outcomes stay missing. The experimental complier estimator exists but is opt-in and
feeds no verdict. Simulation protocols and results are documented under `reports/caffeine-*`
(v2, v3, v3.1 addendum, v3.2 verification).

## 9. What was done most recently (this session, uncommitted)

| Change | Files | Why |
|---|---|---|
| Account deletion unblocked | `supabase/schema-all.sql` | The locked-day trigger refused the cascade delete on any account with a completed test. Deletion now raises a transaction-local bypass flag and deletes rows before the account row; sample rows are exempt so the dev tool works too. |
| Device wipe made real | `src/data/local-wipe.ts` (new), `src/data/experiment-store.ts` | The old wipe named seven keys by hand, missed anything added later, and reported nothing. It now selects by shape, returns what it removed, and never touches another account's copy. |
| Delete flow can't strand the user | `src/app/settings.tsx`, `src/store/auth.ts`, `src/lib/auth.ts` | Server failure is shown and changes nothing; after success, reminder cleanup, wipe and sign-out are best-effort, and the in-memory session is dropped if sign-out fails. Errors now carry the PostgREST code. |
| Clear-device tells the truth | `src/app/settings.tsx` | Warns before losing entries that never synced, and says how many items it cleared instead of claiming success while the server copy repopulates the screen. |
| Check-in crash fixed | `src/components/CheckInCard.tsx` | A stray same-line gap between two closing tags became a raw text child and crashed React Native on the Daily screen. |
| Guard against that class | `scripts/jsx-text-guard.test.ts` (new) | Scans every `.tsx` for whitespace text nodes; proven to fail on a deliberately broken probe file. |
| Tests + docs | `scripts/account-deletion.test.ts` (new), `README.md` | Pins the sweep rules, the delete helper's error detail and the SQL invariants; the README now says the schema file must be run (its old "no SQL required" line was wrong and is how deletion ends up silently broken). |

**Uncommitted:** the seven modified files above plus four new ones — the three listed there and
this report. Last commit is `f2f9f6a`.

## 10. Verification, honestly

| Check | Result |
|---|---|
| `npx expo lint` | pass |
| `npx tsc --noEmit` | pass |
| `npx tsc -p tsconfig.engine.json --noEmit` | pass |
| `npx tsx --test scripts/*.test.ts` | 185 tests, 185 pass, 0 fail |
| `npm run verify:freeze` | 10 engine files match the SHA-256 manifest |
| `npm run test:env`, `npm run test:auth` | pass |
| `node scripts/contrast-sanity.cjs` | 20 pairs at 4.5:1 or 3:1 |
| Rendering on a device | **not verified by me.** Web render confirms the light palette on the sign-in screen; the three redesigned screens were confirmed by hand on iOS. |
| The deletion SQL | **not executed anywhere.** No database in this checkout and SQL is text-only here. |
| Reminders | **cannot be verified in Expo Go** — no reliable local-notification behaviour without a development build. |

There is **no CI**, so none of the above runs automatically: it is all manual or agent-run.

## 11. Documentation that already exists

- `README.md` — setup, env, routes, verification commands, database step.
- `AGENTS.md`, `AGENT_RULES.md` — how to work in this repo, and the plain-words brief.
- `src/engine/README.md` — the engine's contract, estimators and what each function may not claim.
- `reports/` — caffeine simulation v2/v3/v3.1/v3.2 protocols and results, adapter verification, screen 1–2 notes, visual redesign part 1.
- `screens/caffeine-time-picker-review.md` — the picker's review and its limitations.
- `supabase/schema-all.sql` — the one file to run; per-screen `schema-*.sql` are historical.

## 12. What to build next

### Stage 0 — land what exists (hours)

1. **Commit and push** the uncommitted fixes above.
2. **Re-run `supabase/schema-all.sql`** in the Supabase SQL editor, then delete an account that
   has a completed test to confirm the lock no longer blocks it.
3. **Walk the three redesigned screens on the phone** and fix anything that only shows up in a
   real layout (dynamic type, long headlines, the thumb zone).

### Stage 1 — what stops this from being shippable (days)

4. **Icons and splash.** There is no `assets/` at all: the app ships the default Expo icon today.
   Needs a real icon, an adaptive Android icon and a splash image matching the Mist background.
5. **A development build.** `eas.json` does not exist. Add build profiles and make a dev client,
   because local notifications cannot be trusted in Expo Go, and that is a core loop of this app.
6. **Legal and privacy.** Replace the draft consent copy, host a privacy policy page, name the
   controller and contact, decide retention, and write down the sensitive-data handling. This app
   stores sleep and caffeine habits, so it is personal data by any definition, and the deletion
   path is the App Store requirement that was just repaired — the rest of that story is missing.
7. **Store readiness.** Bundle identifiers, versioning, screenshots, an age rating, the medical
   disclaimer in the description, and an internal track test.

### Stage 2 — what makes it a product (weeks)

8. **Data export** ("download everything I logged") as JSON/CSV, sharing a screen with delete.
   Users who can delete expect to be able to take their data.
9. **Session and account edges:** email change, re-authentication when a token dies mid-session,
   a clear message when a signup confirmation email has not been confirmed yet.
10. **Reminder robustness:** timezone and DST changes, quiet hours, per-slot on/off with the
    device's permission state, and a test pass on a real build.
11. **Multi-cycle value:** comparing two finished tests side by side, and a plain "what changed"
    line between cycles. The data is already stored per plan; nothing new is computed.
12. **Onboarding:** three short screens before consent that answer "what am I doing, how long,
    and what will I get", because the current first run starts at a consent form.
13. **Accessibility on device:** the largest text size, VoiceOver/TalkBack pass, focus order,
    and the reduced-motion paths beyond the disc.
14. **Localization groundwork** if German or another market matters — with the copy rules already
    written down, the strings are the easy part; the date and caffeine-time handling is the work.

### Stage 3 — engineering hygiene (parallel, ongoing)

15. **CI:** run lint, typecheck, both typechecks, the full suite, `verify:freeze` and the contrast
    check on every push. There is no `.github` today, and the engine freeze only means something
    if the check actually runs.
16. **A device smoke harness:** a dev-only route that mounts each screen with fixture data and
    logs render errors. This session's crash went unnoticed precisely because a screen can only be
    exercised by hand on the phone; the static guard covers one class, not the general case.
17. **Error monitoring** (Sentry or similar) and **funnel analytics** (consent → first log →
    completed test). Both need a service decision before code; neither is wired up.
18. **Real migrations:** replace the paste-one-file workflow with versioned Supabase migrations
    before the schema changes again, and review RLS plus auth rate limits at the same time.
19. **Offline correctness:** tests for two devices writing the same day, and a documented rule for
    which write wins.
20. **Release mechanics:** OTA update channels, a rollback plan, and a short release checklist.

## 13. Suggested order

| Order | Item | Why first |
|---|---|---|
| 1 | Commit + push (§12.1) | Everything else builds on a clean tree |
| 2 | Re-run the SQL, confirm delete works (§12.2) | A broken delete is an App Store blocker |
| 3 | Phone pass on the three screens (§12.3) | The redesign is unproven until seen |
| 4 | Icon + splash + dev build (§12.4–5) | Without them there is nothing to put in a tester's hands |
| 5 | Legal and privacy (§12.6) | The longest lead time, and it constrains the copy |
| 6 | CI + device smoke harness (§12.15–16) | Stops the next regression reaching the phone |
| 7 | Data export, account edges, reminder robustness (§12.8–10) | Finishes the data story the delete fix started |

## 14. Risks

- **Health-adjacent data with draft legal text.** The most serious open item, and not a coding one.
- **One maintainer, no CI, no device tests.** Regressions currently leave the building and are
  caught by hand on a phone.
- **The engine freeze cuts both ways:** good for trust, but any fix to the statistics needs its
  own documented re-freeze, so statistical changes should be batched deliberately.
- **Expo Go's notification limits** can hide real reminder bugs until a dev build exists.
- **Notification permission is asked once**, so a user who declines once cannot be re-asked by the
  app — a product decision that should be revisited alongside §12.10.
