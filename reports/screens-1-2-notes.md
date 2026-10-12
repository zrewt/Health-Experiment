# Manual Testing & Implementation Notes: Screens 1 & 2

## 1. Overview & Architecture
This milestone introduces:
- **Persistence layer:** [experiment-store.ts](src/data/experiment-store.ts) with AsyncStorage local cache and Supabase client integration.
- **Local calendar date utilities:** [dates.ts](src/experiment/dates.ts) with engine-aligned exposure day convention.
- **View-model helper:** [view-model.ts](src/experiment/view-model.ts) wrapping `checkCaffeineEligibility` for descriptive baseline metrics without new statistical models.
- **Screen 1 (Setup & Consent):** [setup-consent.tsx](src/app/setup-consent.tsx) implementing 3-point plain explanation, experiment description, screening question with honest advice, engine-default cutoff picker, draft informed consent, and draft privacy policy placeholder.
- **Screen 2 (Run-in):** [run-in.tsx](src/app/run-in.tsx) implementing valid-day progress tracking (14 valid days), morning check-in under 30 seconds, 3-day history with edit guards, and descriptive metrics after 3 valid days.

## 2. Alignment Convention
- **Engine rule:** In `src/engine/types.ts` (line 31) and `src/engine/analysis.ts` (line 251), `DayRecord.date` is the exposure day, which pairs with the **following night's sleep**.
- **Morning check-in:** When checking in on `today`, the user reports the sleep they just woke up from (night of `today - 1` to `today`) and yesterday's caffeine intake (exposure day `today - 1`).
- Therefore, `getMorningEntryDate(today)` maps to calendar date `today - 1`.

## 3. Adapter Seed Determinism Report
- In `src/experiment/adapter.ts`, `evaluate()` passes `seed: plan.seed` into `analyzeExperiment`.
- Because `plan.seed` is stored deterministically during `startExperiment` and cannot mutate, analysis resampling and intervals are completely deterministic and reproducible across repeated evaluate calls on the same plan and entries. No new `analysisSeed` was necessary.

## 4. Legal / Clinical Notices
- **Draft Notice:** The consent copy and privacy policy placeholder are explicit **drafts** requiring human legal review before publishing.
- **Medical Disclaimer:** App contains: *"This app is not medical advice."*
- **No causal claims, power, MDE, SD, effect, or verdicts** are shown on Screens 1 or 2.

## 5. How to Run the App
- Dev server: `npx expo start`
- Typecheck: `npm run typecheck`
- Engine typecheck: `./node_modules/.bin/tsc --noEmit -p tsconfig.engine.json`
- Lint: `CI=1 npm run lint`
- Freeze check: `npm run verify:freeze`
- Tests: `npx tsx --test scripts/domain-screens.test.ts`

## 6. Manual Testing Checklist
1. **Setup & Consent Screen:**
   - [ ] Navigate to `/setup-consent`.
   - [ ] Verify the 3-point plain explanation and *"This app is not medical advice."* are visible.
   - [ ] Select "Rarely or never": verify honest notice appears with "Continue anyway" and "Not now".
   - [ ] Check cutoff time options; verify default is `12:00`.
   - [ ] Tap "View Draft Privacy Policy": toggle placeholder visibility.
   - [ ] Tap "I don't agree": verify decline screen appears with explanation that data cannot be collected without consent.
   - [ ] Check affirmative checkbox and tap "I agree & start run-in": verify navigation to `/run-in`.
2. **Run-in Screen:**
   - [ ] Verify header shows `0 of 14 valid days`.
   - [ ] Log 7 hours 30 mins sleep and 14:00 caffeine: tap "Save check-in".
   - [ ] Verify sleep outside 2 to 14 hours prompts confirmation before saving.
   - [ ] Tap "No caffeine": verify caffeine time field clears and disables.
   - [ ] Skip sleep (leave blank): verify progress count does not increment (missing is not zero).
   - [ ] Verify past 3 days list: yesterday and previous 3 days allow edit; older days display read-only.
   - [ ] Log 3 valid days: verify descriptive panel appears showing days logged, average sleep, afternoon caffeine days, and unknown days.

## 7. Files Changed and Decisions
- `src/app/_layout.tsx`: register setup and run-in routes.
- `src/app/index.tsx`: route signed-in users into setup/run-in flow.
- `src/app/setup-consent.tsx`: consent and setup form; agreement starts unchecked and “I don't agree” appends a decline record.
- `src/app/run-in.tsx`: run-in check-in, visible local unsynced status and retry action.
- `src/data/experiment-store.ts`: setup, consent, entry persistence and sync helpers.
- `src/experiment/dates.ts`, `src/experiment/view-model.ts`: local calendar arithmetic and descriptive baseline summary.
- `scripts/domain-screens.test.ts`: calendar and screen view-model tests.
- `supabase/schema.sql`: initial schema for setup, entries and consent (provided as SQL text; not run).
- `src/components/ui/Text.tsx`, `package.json`: platform/style and test-script adjustments.
- Decision: null remains missing, eligibility is withheld on Screen 2, and pending local entries must stay visible until server sync succeeds.
- Open questions: legal/privacy copy requires review; apply the provided Supabase schema in the project's deployment process before relying on cloud persistence.

## 8. Persistence Failure Behavior
- A daily entry is first written to AsyncStorage. A failed or unavailable Supabase upsert leaves it marked `synced: false`; the UI identifies it as “not synced yet” and attempts a retry, with a manual Retry Sync action if it remains pending. A successful server fetch preserves pending local entries instead of overwriting them.
- Setup values are cached locally and a failed Supabase setup upsert throws, so the setup screen does not navigate as though the cloud write succeeded. Consent decisions are recorded locally and appended to Supabase; a failed server write throws and the UI does not report the action as complete.
- The consent checkbox defaults to unchecked; “I don't agree” stores `granted: false` and displays the decline state after save succeeds.

## 9. Follow-up Manual Checks
- [ ] With Supabase writes unavailable, save a check-in: verify “not synced yet” remains visible and the cached entry survives reload.
- [ ] Restore connectivity or tap Retry Sync: verify pending entries become synced only after successful upsert and null fields remain null.
- [ ] Cause setup/consent writes to fail: verify no success navigation or decline confirmation is shown until the write succeeds.
- [ ] Inspect the run-in summary object: exact keys are `daysLogged`, `averageSleepMinutes`, `afternoonCaffeineDays`, `unknownCaffeineDays`, and `validDays`; it exposes no eligibility, reason, or threshold fields.
