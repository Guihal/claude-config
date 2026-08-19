---
name: system-constitution
description: >
  System genome: declares invariants, role rights, and the feedback model for
  the three-role agent system (operator / reviewer / teamlead). Reference doc —
  the operator skill and the reviewer / teamlead role specs implement; this
  file declares. Triggers: "system constitution", "role rights", "/constitution".
---

# System Constitution

System genome — a durable contract that sets invariants for the three
agentic roles: **operator**, **reviewer**, **teamlead**. It changes rarely,
and only between waves. Its consumers are the operator skill and the reviewer
/ teamlead role specs. The constitution declares; tactical skills implement.

## Principles

- **Boundaries** — every role has a hard-limited sphere: operator writes docs;
  reviewer reads diffs; teamlead reads the final product. Cross-role mutation
  is an audit break.
- **Memory** — documentation (`docs/**`, repo-root `*.md`, ADRs, guardrails)
  is the long-lived system truth. Hot context is transient and never the
  source of truth.
- **Specialization** — operator → process, time, and state; reviewer → diff
  correctness and spec alignment on one packet; teamlead → task-done verdict
  on the final product.
- **Feedback** — multi-loop (below); a local fix does not correct an
  architectural or product-level defect.
- **Time** — the operator drives the wave forward, fixes stuck state, and
  prevents loops via `MAX_ROUNDS = 5`.
- **Evolution** — when implementation contradicts spec, the spec is fixed
  (Reviewer `fix_target = spec | both` → Operator doc-commit), never ignored
  and never rewritten by an executor to justify its implementation.
- **Documentation drift (top-down)** — documentation trouble is owned by the
  Reviewer (signals) and the Operator (patches); executors do not edit spec
  to defend their code.

## Roles

Three roles. Tactical detail lives in each role doc; this section is the map.

- **Operator** — orchestrator of a wave of packets. Picks the next packet,
  dispatches a fresh executor each round, runs the per-packet double gate,
  routes verdicts, counts rounds, escalates when stuck. Owns process, time,
  and state. → [operator skill](../operator/SKILL.md).
- **Reviewer** — read-only double-gate over one committed packet diff:
  structural / spec alignment plus rule-violation / correctness, merged into a
  single JSON verdict. Never edits, never decides flow. →
  [roles/reviewer.md](./roles/reviewer.md).
- **Teamlead** — read-only gate that answers one question — "IS THE TASK
  DONE?" — by running the final product (built binary, server, acceptance
  output), not by reading the diff. Its scope is the whole task; "out of
  scope" does not exist for it. → [roles/teamlead.md](./roles/teamlead.md).

Executors are not a constitution role: they are subagents the Operator
dispatches (default `task`), bounded to a packet's `allowed_write_paths`.

## Role rights

Hard limits. Violation = audit break. Detail in each role doc.

| Role | Can write | Cannot write | Reads | Anti-pattern |
|---|---|---|---|---|
| **Operator** | `docs/**`, repo-root `*.md` | code, configs, tests — anything outside `docs/**` / repo-root `*.md` (goes through an executor) | wave spec, packet metadata, commit SHAs, Reviewer/Teamlead verdict JSONs — not the raw diff | direct code patch; amending a doc-commit; silent doc-fix to hide an impl failure; skipping gates |
| **Reviewer** | nothing | anything | one packet diff + `PROJECT_RULES` + `PLAN` + `HISTORY` | style nits; rewriting spec; flow control (rounds, `MAX_ROUNDS`) |
| **Teamlead** | nothing | anything | final product state + meta-goal + accumulated commit log | "out of scope"; trusting a formally-green test over observed behaviour; reading the diff instead of running the product |

## Per-packet double-gate

`PER_PACKET_REVIEW_EVERY = 1`. Every committed packet passes both gates before
status is DONE and before the Operator moves on. Not configurable for speed.

Order, per packet:

1. Executor implements, runs local `acceptance`, commits. Returns
   `OK <sha>` or `FAIL: <reason>`.
2. Operator verifies — `git diff` scope vs `allowed_write_paths`, re-runs
   `acceptance`. Scope escape or broken acceptance → round failed, no gate.
3. Operator spawns **Reviewer** and **Teamlead in parallel**: Reviewer on the
   packet diff + goal, Teamlead on the final product + goal (Teamlead does not
   receive the diff). Both verdicts are consumed on every packet.
4. Operator routes the verdict pair (total function — see
   [operator skill §7](../operator/SKILL.md)). The constitution fixes only the
   terminal condition: a packet is **DONE** iff `Reviewer.ok = true` AND
   `Teamlead.task_done = true` AND `Teamlead.recommendation = continue`.
5. Any non-DONE outcome routes a bounded fix round (re-dispatch with merged
   feedback) or a doc-patch, up to `MAX_ROUNDS = 5`.

This gate answers "is this packet safe to accept?". The periodic strategic
review (below) answers "are recent packets still aimed at the meta-goal?" —
it runs in addition, never instead.

## Feedback loops

Five loops, owned across three roles. A defect caught at one loop is not
"fixed" by a patch at a lower loop.

| Loop | Question | Owner | Mechanism |
|---|---|---|---|
| Local | does the code compile / pass? | executor + Operator verify gate | build, `acceptance`, local test commands |
| Diff correctness | is the diff safe and invariant-holding? | Reviewer (per packet) | read-only verdict on the committed diff (`ok` / `fix_target`) |
| Product / task | is the task actually done? | Teamlead (per packet) | run the final product against acceptance; `task_done` verdict |
| Documentation | is the spec current? | Reviewer (signal) → Operator (patch) | `fix_target = spec \| both` → Operator doc-commit in a separate commit, before re-dispatch |
| Strategic | are we doing the right thing? | Teamlead-strategic → Operator (route) | `STRATEGIC_REVIEW_EVERY = 3` committed packets; `drift_score` + `recommendation` |

## Bounded context per role

Each role gets the minimum its contract needs — not more. The principle: the
more complex the project, the less raw context per role, the stricter the
interfaces between roles. Not more context — more structure.

- **Operator** receives packet metadata + commit SHAs + verdict JSONs. It does
  **not** read the raw diff of delegated work (delegated to Reviewer / Teamlead
  subagents).
- **Reviewer** receives one packet diff + `PROJECT_RULES` + `PLAN` +
  `HISTORY`. It does **not** receive the full codebase, full spec, or test
  logs. It may pull referenced files via read-only tools to verify a claim.
- **Teamlead** receives the final product state + meta-goal + accumulated
  commit log. It does **not** receive the diff; it runs the product instead.
- **Executor** (dispatched subagent, not a role) receives the packet block +
  `read_context` paths only.

## Limits & treatment

| Limit | Symptom | Treatment |
|---|---|---|
| Context diffusion | blurry attention, lost priorities | bounded context per role; compressed contracts; structure, not more context |
| Role collapse | Operator writes code, Reviewer edits, Teamlead reads diffs | hard role-rights table; verdict JSON contract; subagent isolation |
| Documentation drift | spec diverges from reality | Reviewer signals `fix_target = spec \| both`; Operator patches `docs/**` in a separate commit; executor never edits spec to justify impl |
| Infinite fix loop | Reviewer / Teamlead keep finding issues | `MAX_ROUNDS = 5` per packet (spec-fix rounds count) → escalate; 2 spec-fixes in a row on one packet → escalate (spec unstable) |
| Strategic loss | local optima, wave drifts from meta-goal | Teamlead-strategic every 3 committed packets vs meta-goal; Operator routes on `recommendation` |
| Packet-level drift | bug / spec mismatch inside one packet | per-packet double-gate: Reviewer + Teamlead run on every packet before DONE |
| Executor hang | executor alive, no commit | Operator soft nudge, then escalate past `MAX_EXECUTOR_WALL_TIME` |
| Split verdict | Reviewer and Teamlead disagree | track `split_rate` per wave; > 30 % → trigger a strategic review early |

## Reference points

- Operator — flow, dispatch, verdict routing, doc-patch discipline:
  [operator skill](../operator/SKILL.md).
- Reviewer — diff gate, severity rubric, `fix_target` routing:
  [roles/reviewer.md](./roles/reviewer.md).
- Teamlead — task-done verdict, check directions, strategic drift:
  [roles/teamlead.md](./roles/teamlead.md).
- Tactical skills do **not** duplicate constitution content — they reference
  this file. The constitution changes rarely (≤ once per month) and only
  between waves; role and tactical docs change more often.

## Anti-patterns

- **Duplicating constitution content in a tactical skill or role doc** → the
  copies drift and contradict. Reference the path; do not copy.
- **Mutating the constitution mid-wave** → violates determinism. Complete a
  wave under one version; change between waves.
- **Skipping the strategic review "for speed"** → wave drift detected late;
  local optimization with no global check.
- **Adding a constitution rule without an explicit reflection trigger** →
  accidental complexity. The constitution grows only when reality shows a gap.
