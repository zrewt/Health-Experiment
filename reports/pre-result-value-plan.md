# Before the finish line: making the wait worth it

A product plan for the two sleep tests. No code yet: this is the thinking, the guardrails,
the copy, and the build order.

---

## 1. What the app gives today

| Moment | What the user gets |
| --- | --- |
| Getting to know your sleep (14 nights) | A dot tracker, "N of 14 nights", a weekly recap sentence, a hidden average |
| Each test day | One line ("Today: cutoff day, no screens after 21:30"), one log button, "Day 12 of 42" |
| "How the test is going" | Counts behind a Details toggle |
| Journal | A 14-day sleep-duration chart and a day list |
| The end | The only place a finding exists |

So the emotional shape of the product is: **two weeks of homework, six weeks of homework,
then a report.** The one mid-journey insight — "is this test worth doing?" — is framed as a
gate the user must pass, not as something given to them.

That is the value problem. Not the statistics: the pacing.

## 2. The strategy in one line

> **Stop selling the result. Sell the mirror.**

The result answers "did the cutoff change my sleep?" — once, at the end. The mirror answers
"what is true about me right now?" — every morning, from the first logged night. It is
honest, it needs no inference, and it is the thing people actually screenshot.

Value before the end comes from three sources:

1. **Self-knowledge** the user did not have: their own range, their own usual, their own
   timing, their own weekday pattern.
2. **Visible behavior change**: proof they are keeping the rule more often, and cutting it
   closer or earlier. Behavior is observable mid-test; sleep contrast is not.
3. **Earned anticipation**: the report is visibly being assembled, and the last night feels
   like a finish line rather than an expiry date.

## 3. Non-negotiables

These come from the existing product rules and the frozen engine, and they are what make the
plan shippable rather than a pile of dark patterns.

- **No interim sleep comparison by day type.** No "you slept 22 min longer on cutoff days so
  far". The adapter throws `INTERIM_LOOK` for a reason, and showing a running contrast invites
  peeking, behavior change, and an invalid result. This rules out the most obvious "aha" and
  forces better ones.
- **No causal or medical language.** No "helps", "improves", "because of". Patterns in your
  own log only.
- **Descriptive, never inferential.** Own average, own range, own times, own consistency.
  Nothing that estimates the test's answer.
- **No shame.** Streaks count logging and rule-keeping. Never count sleep length, never red
  for a missed night, never "you failed".
- **One idea per screen.** The mirror is one card with one headline number. Everything else
  stays under Details, as today.
- **No claims from thin data.** A pattern card needs at least 3 nights; a weekday card needs
  at least 2 of that weekday. Otherwise it waits.

## 4. The aha ladder

Ranked by (impact × honesty × effort). "Night" means a completed check-in.

### 1. The Morning Mirror — the daily magic moment

Shown the moment a check-in is saved, and kept as the top card on Today until the next log.

> **7 h 12 min — 18 min above your usual.**
> You stopped screens at 21:10, 20 min before the cutoff.
> That's 3 cutoff days kept in a row.

Why it lands: it is specific, true, and about *them* — the exact time they stopped, compared
to their own recent nights, not to a group or to the other condition. It turns a data-entry
chore into a receipt. The third line is the behavior proof, which is the only "progress"
that is real before the end.

Rules: baseline is the last up-to-7 logged nights *before* the target night; the delta is
omitted under 3 baseline nights; the card never mentions cutoff vs normal sleep; a fixed
subline says "Your own numbers, not your result."

### 2. "Your nights vary more than you think" — the first real aha

Unlocks at 3 logged run-in nights, replaces the current generic progress sentence.

> **Your nights so far run from 6 h 40 m to 8 h 05 m.**
> That spread is why one night can't answer the question — and why this takes weeks.

This is the aha that makes the wait feel *necessary* instead of arbitrary. It uses the
baseline SD the app already computes, expressed as a range, with no statistics vocabulary.
It also pre-frames the feasibility screen: the user arrives already understanding why a test
might not be able to tell.

### 3. Progress that counts what the user controls

Replace the primary progress metric.

- Today: "9 of 21 cutoff days kept" and "6 of 21 pairs done", with paired dots.
- Best run: "Your best run so far: 4 cutoff days."
- Buffer: "You stopped 30+ min before the cutoff on 7 of 9 cutoff days."

Days elapsed is a clock. Kept days is an achievement. Pairs make the design legible ("days
come in pairs, picked at random") and explain why the test can answer at all.

### 4. The tonight ritual — a live countdown and one tap

On a cutoff day, after the morning log:

> **Screens off in 38 min.**
> [ I'm off now ]

The tap records the actual time (local, editable next morning) and pre-fills the next
check-in. This gives the app an evening presence without nagging, and it improves the data
that the final result depends on. It also creates the single most satisfying interaction in
the product: a button that ends your day.

Guardrails: appears only on cutoff days, disappears after the cutoff, never pushes more than
the existing `before-cutoff` reminder, and the pre-fill is always confirmed by the user
(never silently logged).

### 5. Milestone cards at 3 / 7 / 14 / 21 nights

One new true sentence, unlocked, then kept in a small "Your numbers" list.

| Night | Card |
| --- | --- |
| 3 | Your range so far (see #2) |
| 7 | "Saturdays run about 34 min longer than weekdays in your log." (only with ≥2 of each) |
| 14 | "You logged 13 of 14 nights. That's better than most sleep logs survive." (behavior, no comparison to others) |
| 21 | "Your cutoff buffer is widening: you stopped 22 min early on average this week, up from 8." |

The cadence matters more than any single card: something new every few days is what makes a
42-day commitment feel alive.

### 6. The report trailer and the sealing ritual

At the midpoint and again three nights out, a details card — no numbers:

> **In 21 nights you'll see:** your sleep on cutoff days vs normal days, how sure we can be,
> and what it can't tell you.

On the last night, after the final log, before the result:

> **That's the last night.**
> You logged 39 of 42 nights and kept 18 of 21 cutoff days. Locking it now.

This is the payoff of the whole plan: the user's effort is reflected back before they are
judged by an outcome. It also makes the final screen feel earned rather than withheld.

### 7. The why-echo

At setup, one optional line: "Why are you doing this?" Resurfaced only when it helps — a
missed cutoff day, a broken logging run — next to the next action, not as a guilt banner.

> You wrote: "mornings with my daughter." Tonight's cutoff is 21:30.

## 5. The daily loop this creates

```
Morning   log → Mirror (one number, two true facts) → Today shows the collapsed mirror
Daytime   Today shows kept-days progress, not days elapsed
Evening   cutoff day → countdown → one tap "I'm off" → pre-fills tomorrow
Weekly    recap upgrades from "you logged 6 nights" to "your usual is 7 h 05 m"
Milestone a new card every 3–7 nights, always descriptive
Last night sealing ritual, then the result
```

The current weekly recap ("You logged 6 nights this week, and slept about 7 h 20 m") is the
seed of this; it just reports activity. The upgrade reports *them*.

## 6. Implementation shape

All new logic is pure and lives in the experiment layer, never in `src/engine/`.

| New file | Purpose |
| --- | --- |
| `src/experiment/morning-mirror.ts` | `getMorningMirror({ entries, plan, today, exposure })` → headline, delta, two facts, trend. Baseline = up to 7 prior logged nights; cutoff buffer from the plan rule; kept-day streak from `adherenceStatus`. |
| `src/experiment/milestones.ts` | `getUnlockedMilestones({ entries, plan, today })` → ordered cards with unlock thresholds and "needs more data" fallbacks. |
| `src/experiment/progress-figures.ts` | Kept/planned cutoff days, pairs completed, best run, buffer average. Deterministic from the schedule and entries. |
| `src/components/MorningMirrorCard.tsx` | The card, with the Details subline and accessibility labels. |
| `src/components/CutoffCountdown.tsx` | Live countdown + one tap; uses the existing time utilities, not a new clock. |

Touch points: `src/experiment/today-dashboard.ts` (progress fields), `src/app/index.tsx` (top
card), `src/app/daily-instruction.tsx` (countdown on cutoff days), `src/app/run-in.tsx` (range
card at 3 nights), `src/app/result.tsx` (what-we-learned-anyway section).

Data: **none required for phase 1.** The countdown tap needs one local key
(`@experiment_intent:<userId>`, a timestamp) and a pre-fill that the user confirms. The why
line needs one setup field (local + `experiment_setup` column) if it ships.

Integrity tests to add, in the spirit of the existing suite:

- The mirror's baseline excludes the target night and any night outside the run-in/test
  window.
- No pre-result model exposes a per-condition sleep value: assert the returned object has no
  `control`/`intervention` sleep field, and that `morning-mirror.ts` never imports `evaluate`.
- Banned-word scan on all new copy (`adherence`, `exposure`, `estimate`, `power`, `interval`,
  `control`, `randomized`) plus causal verbs.
- Milestones never unlock on thin data; every card's threshold is covered by a test.
- Countdown math around midnight and DST, and hidden after the cutoff.

## 7. Build order

**Phase 1 — the mirror (1–2 weeks).** Mirror card, range card at 3 nights, kept-days/pairs
progress, upgraded weekly recap. This alone changes the daily experience from homework to
feedback, and it needs no schema change.

**Phase 2 — the ritual (1 week).** Countdown + one-tap "I'm off", intent pre-fill, milestone
cards at 7/14/21.

**Phase 3 — the finish line (1 week).** Report trailer, sealing ritual, why-echo, and a
"what we learned anyway" block on the result (variability, weekday pattern, cutoff buffer) so
a null result still returns something.

## 8. How to know it worked

North star: **share of started tests that reach a result.** Everything else is a leading
indicator.

- Mirror seen within 24 h of first log (activation).
- Night-3 and night-7 return rate.
- Log completion: nights logged ÷ nights scheduled.
- Cutoff days kept ÷ cutoff days scheduled.
- Result reach rate, split by test.

Measure locally first (the dev diagnostics panel already has most of these inputs) and add an
events table only if the numbers need cohorting. Do not add an analytics SDK for this.

## 9. Risks and kill criteria

| Risk | Mitigation |
| --- | --- |
| The mirror feels like judgment | Neutral tone, no red, no "should"; test with 5 users before shipping phase 2 |
| Users read the mirror as the result | Fixed subline "Your own numbers, not your result." on every mirror card |
| More cards dilute the one-idea screen | Hard cap: one insight card visible at a time; the rest live under "Your numbers" |
| Sparse data produces a wrong-sounding claim | Minimum 3 nights for any statement; weekday cards need 2 of that weekday |
| The countdown becomes pressure | Only on cutoff days, only if reminders are already on, one tap to dismiss for the night |
| Behavior change biases the test | Mirror reports timing and keeping, never sleep by day type; the contrast stays locked until the end |

## 10. What I would deliberately not build

- A live effect estimate, confidence interval, or "you're 80% likely to see a difference".
- A single sleep score — it invites optimization of the number instead of the habit.
- Streaks on sleep duration, or any comparison to other users.
- Push notifications that mention sleep performance; the existing morning and before-cutoff
  reminders are enough.

## 11. The one bet, if only one ships

**The Morning Mirror.** One number compared to their own usual, one exact time, one behavior
fact, delivered in the 10 seconds after they log. It is the only feature here that makes the
app worth opening on a day when nothing else happens — and it is the reason the other six
ideas have somewhere to live.
