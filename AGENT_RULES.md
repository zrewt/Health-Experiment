# WORDING

Plain-words pass: make the app feel simple and friendly. Change copy and layout only. No logic changes. Read every screen under `src/app`, the shared components and the reminder copy first. Do not invent names; find them.

## Wording rules

- One idea and one main button per screen. About 25 visible words per screen, excluding inputs and buttons. Reading level grade 6 to 8.
- Banned on main screens: power, minimum detectable effect, interval, p-value, estimate (outside Details), adherence, contamination, exposure, randomized, block, policy, run-in, feasibility, assigned, control.
- Use these words: sleep test (not experiment), Getting to know your sleep (not run-in), Is this test worth doing? (not feasibility), cutoff day (not assigned day), normal day (not control day), What we found (not result), cautious estimate (under Details only).
- Feasibility shows one plain verdict (Good bet, Worth a try, Probably not enough to tell), one reason and one action. All numbers go under a Details toggle.
- Daily screen: one big line ("Today: cutoff day, no caffeine after 12:00" or "Today: normal day"), a log button, and "Day X of Y". Move "End early" into a menu.
- Result: blocks "What we found", "How sure we are", "What to do next". Headlines come from the existing fixed headings mapping, rewritten in plain descriptive words.
- Consent: a four-bullet summary (what you will do, what we keep, you can stop and delete any time, not medical advice) and a link to the full text. Keep the separate agree step. Keep the existing placeholder legal text; do not write legal text.
- Details toggle: build it as a small component with no new dependency. Keep it accessible (labels, large text, contrast, no colour-only meaning).
- Engine sentences and limitations stay VERBATIM (they may sit under Details). Never add causal or medical claims (no helped, improves, causes, treats). Keep "This app is not medical advice" wherever it appears now. Keep no thresholds or power on the run-in screen.
- If you change reminder copy, the repeating reminder must stay day-agnostic.

## Hard rules

- Never edit `src/engine/`. Screens use the engine only through `src/experiment/`. No new statistical code.
- View a file before editing it. Ask before adding any dependency. SQL only as text, never run.
- Git: add explicit paths only; never force push, reset, rebase, amend, checkout, restore or stash; never commit .env files; leave `temp.bundle` and `.audit-clone-path` alone.
- Tests that assert changed copy: update them deliberately and list which ones.
