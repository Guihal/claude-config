---
name: debug-hypotheses
description: Use when a bug, test failure, or unexpected behavior appears and you are about to propose or apply a fix — especially when one "obvious" cause came to mind first, a previous fix didn't work, the error makes no sense, or you're under time pressure.
---

# Debug Hypotheses — storm wide before you fix

The first explanation that comes to mind is a prior, not a diagnosis. STOP.
Enumerate MANY competing hypotheses first (minimum 8 — more is better), then
kill them with cheap evidence, only then fix. This is Chamberlin's method of
multiple working hypotheses applied to debugging: one favorite theory =
confirmation bias; a field of rivals = investigation.

## Iron law

```
NO FIX, NO EDIT, NO "let me just try..." BEFORE THE HYPOTHESIS TABLE EXISTS.
```

## Step 1 — STORM (≥8 hypotheses, write them all down)

Sweep every category; force at least one hypothesis per category even if it
feels unlikely — the unlikely ones are the point:

| Category | Ask yourself |
|---|---|
| Logic | wrong conditional, off-by-one, missing case |
| Data | null/empty, wrong type, encoding, serialization |
| State / timing | race, stale cache, init order, leftover state from prior run |
| Integration | API contract drift, version mismatch, wrong config picked up |
| Environment | missing dep, platform diff, env var, permissions |
| Resource | memory, connections, disk, limits |
| Build / cache | stale artifact, wrong bundle served, old code actually running |
| My own change | recent diff caused it (`git diff`, `git log`) |
| Wrong report | the symptom is misreported; the bug is elsewhere / there are TWO bugs |
| Wrong mental model | "my assumption about how X works is wrong" — name the assumption |

Must include: ≥2 hypotheses a developer would NOT consider first, and ≥1
"my assumption is wrong". Under 8 total = storm again, wider.

## Step 2 — RANK by cost-to-test, not by likelihood

For each: `H# | one-line claim | cheapest discriminating test`. A
discriminating test is a read, a grep, one log line, one command — something
whose outcome differs depending on whether H# is true. Sort by test cost
ascending. Likelihood-first ordering is the confirmation-bias trap this skill
exists to prevent.

## Step 3 — DISCRIMINATE

Run cheapest tests first. Tag any instrumentation with its hypothesis
(`[H3]`) so output maps to theories. Verdict per hypothesis:
**confirmed / falsified / inconclusive**. Absence of evidence ≠ falsified.
One log run can discriminate several H at once — batch the tags.

## Step 4 — only now fix

One confirmed hypothesis → minimal fix → verify the BUG is gone (not "it
compiles", not "it works on my machine"). Remove `[H#]` instrumentation.
All falsified? The storm was too narrow — storm again wider. Do NOT pick the
"least falsified" one and patch on hope.

## Red flags — STOP, back to Step 1

- "It's probably X, let me fix that" (zero or one hypothesis written)
- "Too obvious to need the table"
- Editing code before any hypothesis has a verdict
- Testing the favorite hypothesis first because it "feels right"
- Fix #2 on top of failed fix #1 without re-storming with new info

| Excuse | Reality |
|---|---|
| "8 is overkill for this bug" | Storming 8 takes 2 minutes. A wrong fix costs hours. |
| "I already know the cause" | Then a discriminating test confirms it in one command. Run it. |
| "No time to enumerate" | Guess-and-check thrashing is the slow path, not the table. |
| "Previous fix almost worked" | "Almost worked" = wrong hypothesis. Re-storm with the new evidence. |

## Fits with systematic-debugging

This skill is the wide funnel in front of root-cause work: storm many →
discriminate cheap → hand ONE surviving hypothesis to the minimal-fix /
failing-test discipline. It replaces "form single hypothesis" with "form
many, let evidence pick one".
