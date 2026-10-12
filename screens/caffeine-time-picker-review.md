# Caffeine time picker review

We replaced the free-text caffeine field in `src/components/CheckInCard.tsx` with a pop-up time picker using `@react-native-community/datetimepicker`.

## What changed

- Added `@react-native-community/datetimepicker@9.1.0` to `package.json` and `package-lock.json`.
- Changed `CheckInCard` to keep one `Date` state (`selectedTime`) instead of a free-text string.
- The time button now opens a modal containing a `DateTimePicker` in time mode.
- On pick, the modal closes and the selected time syncs to `selectedTime`, then the button display updates.
- Added a Done button in the modal for explicit closure.
- Kept the existing `noCaffeine` toggle separate.
- Added a small client-side format guard on save so malformed data is caught before it reaches the backend and shows a clear message: `Please pick a time in HH:MM format (for example 14:30).`
- After a successful save, the validation message is cleared.

## Files

- `src/components/CheckInCard.tsx`
- `package.json`
- `package-lock.json`

## Confirmation

- `npx tsc --noEmit`: passed
- `CI=1 npm run lint`: passed
- `npm run typecheck`: passed
- `npm ls @react-native-community/datetimepicker`: `9.1.0`
- Current branch HEAD: `0dae85c`

## Note

This is a native module change. If the app on device is still using the previous dev client build, the time picker may not work until the dev client is rebuilt or reloaded so the new native module is included.

## Relevant earlier error

The earlier app error `Time must be local HH:mm.` came from `src/engine/adherence.ts` on save, and the same save path appears in `src/app/run-in.tsx`. `CheckInCard.tsx` now validates and fixes that input locally only. `run-in.tsx` still uses a text field and was not changed by this task.

---

## Audit addendum (follow-up review, working tree only)

No dependency was added, upgraded, or removed in this pass.

### Dependency
- `@react-native-community/datetimepicker@9.1.0` is in `package.json` + `package-lock.json`, and only that line changed. `npx expo install --check` flags only pre-existing patch drift (`expo`, `expo-router`, `expo-splash-screen`) and does NOT flag the picker, so 9.1.0 is compatible with the installed Expo SDK 57.

### The run-in screen was NOT replaced
- `src/app/run-in.tsx` still owns its own inline check-in form with a free-text caffeine `Field`; it does not import `CheckInCard`. `CheckInCard` is used only by `src/app/daily-instruction.tsx` and `src/app/result.tsx`.
- The note above ("`run-in.tsx` ... was not changed by this task") is out of date: `run-in.tsx` was changed additively with HH:MM normalization/validation and a "Check-in saved." confirmation.

### Run-in behaviours checked - all preserved
- Skipping each field: blank sleep hours+minutes -> null; blank caffeine -> null.
- 3-day backfill: `pastDays` still lists yesterday, -2 and -3 with per-day status.
- "not synced yet": the `saved.synced === false` banner and retry-sync path are intact.
- Descriptive panel: still rendered once 3+ valid days are logged.
- No run-in behaviour was lost.

### adapter.ts
`toEngineRecord` now pads single-digit hours (`9:30` -> `09:30`) and coerces blank/malformed time strings to null, which is what removed the `Time must be local HH:mm.` crash. It is deliberately lenient (malformed input becomes "unknown" rather than throwing). Locked by a new test in `scripts/experiment.test.ts`.

### Gaps fixed in CheckInCard.tsx
1. Caffeine time could not be left unset: it initialised to the current time and always saved a fabricated "now" (violating MISSING IS NOT ZERO). `selectedTime` is now `Date | null`; an untouched field saves null (unknown), and the "Select caffeine time" placeholder is reachable again.
2. The selected time button used ivory text on a champagne background (~1.6:1). It now uses `ground` text when selected, matching the primary button.
3. Android `dismissed` events left the modal open; both `set` and `dismissed` now close it (only `set` records a time).
4. Toggling "No caffeine", or tapping the caffeine field while it was set, silently wrote the current time. No state is fabricated now; an explicit pick clears "No caffeine".

### Known limitation (not fixed)
`@react-native-community/datetimepicker` has no web implementation - its `src/datetimepicker.js` fallback returns `null` and warns. On web (`expo start --web`) the modal therefore renders only its title and the "Done" button, so a time cannot be chosen. Native iOS/Android are unaffected.

### Verification (this pass)
- `npx tsc --noEmit`: pass
- `CI=1 npm run lint`: pass
- `npx tsx --test scripts/*.test.ts`: 132 pass / 0 fail
