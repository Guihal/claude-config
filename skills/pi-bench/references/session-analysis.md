# Session-analysis brief

The deterministic + telemetry + judge layers score each run in isolation. This layer is different:
it reads the raw `session.jsonl` of a whole bench session **across configs** and asks how the
harness changes the model's behaviour and what it costs — the question a harness author acts on.
It is one subagent per bench session (not per run), producing one `results/ANALYSIS-<date>.md`.

Dispatch a `general-purpose` subagent with the brief below. Paths only; it parses with python3
stdlib and quotes concrete evidence (record index, token counts, actual text). It must not invent.

## Dispatch prompt (fill the session paths)

```text
Analyze the raw pi session JSONL of one bench session and write a comparative BEHAVIOURAL analysis:
full harness vs bare baseline, same model, the tasks that were run. The question is not pass/fail
(already graded) — it is how the harness changes the model's behaviour and what context pressure it
imposes. n=1 per cell: state trace observations as fact, mark every causal claim as a hypothesis.

SESSIONS (one line each, label = <task>-<config>):
  <RESULT_DIR>/session.jsonl  ...

JSONL schema (verify it yourself, do not trust this): one JSON object per line. Records:
{"type":"session"}, {"type":"model_change"}, {"type":"custom","customType",...} (harness
injections), {"type":"message","message":{role,content,usage,...}}. role ∈ user|assistant|
toolResult. assistant content is a list of blocks {type: thinking|toolCall|text}. usage has
input/output/cacheRead/cacheWrite/reasoning/totalTokens. NOTE: the rule catalogue is NOT serialised
into the JSONL — it rides the cached system prefix, visible only as cache_read tokens, not as text.
The full-run user turn differs from baseline by a small injected preamble; measure it, don't assume
its size. `custom` records and log_growth in each metrics.json show what fired.

Cover, comparing full vs baseline per task:
1. Context pressure: per-turn input and cache_read; the fixed system prefix size (from cache_read)
   and how many times it is re-attended; total-token and wall-time multipliers and WHERE they come
   from (read-side vs output). Quantify — this is the core question.
2. What is injected: custom customTypes and metrics.json log_growth channels, each with a count and
   a one-line quote; whether auditors actually produced verdicts.
3. Behavioural effect: does the pressure change trajectory — thinking length, tool-call count,
   self-checking, report tone/verbosity, following vs ignoring injected rules? Tie any claimed
   effect to a specific decision point in the trace. For a task that failed a check, look for
   whether the failure plausibly relates to the harness or is an independent implementation choice —
   be careful, n=1.
4. Signals for the harness author: 2-3 concrete, evidence-backed observations that would matter to
   someone tuning the harness (which injectors earn their per-turn cost, rules present but not
   applied, gates that fired without producing anything).

Write to <RESULT_DIR-parent>/ANALYSIS-<date>.md. End with a "Bottom line" section. Reply with the
path and a 5-line summary.
```

## After it returns

- Verify a couple of its token numbers against the run's `metrics.json` (they must agree) and that
  any quoted `custom`/log figures exist — a fabricated number invalidates the analysis, redo it.
- The analysis is a committed artifact of the bench session (same commit as the results).
- It is comparative, so it needs at least one full and one baseline run of the same task in the
  session; if the session had only one config, say so and skip this layer.
