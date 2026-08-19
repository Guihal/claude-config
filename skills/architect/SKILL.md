---
name: architect
description: "Architectural-review loop. Analog of /task skill but critic verifies implementation against spec docs (docs/specs/*.md, packet README), not code-level rules. Always-Opus critic. Returns strict JSON verdict with fix_target routing (impl|spec|both|escalate). Use when packet implementation needs architectural reconciliation with intent. Usage:  /architect [--depth=standard|complex] --spec=<paths> --diff=<base..head> <task description>  OR  /architect --packet=<readme>#<id> --base=<sha>."
---

# Architect

Architectural-review loop. Mirrors `/task` skill shape but swaps critic role: from code-level rule enforcement to spec-level intent verification. Read-only verdict producer. Caller (operator или user) applies the fix — architect не trogает files.

## Контракт

- **Worker** = реализатор. Caller solves; architect не patches.
- **Critic role** = spec-level:
  - structural blocks (что должно быть, чего нет);
  - layer placement (правильный ли слой/папка);
  - unfinished goals (все ли пункты packet `goal` выполнены);
  - spec contradictions (spec упирается в реальность).
- **Critic model** = **Always-Opus 4.7**. Без вариаций. Слабая модель пропустит structural drift.
- **Phases** (linear, не iterative внутри phase): spec-read → impl-diff-read → reconcile.
- **Severity enum**: `missing` / `misplaced` / `unfinished` / `spec_ambiguous` / `spec_contradicts_reality`.
- **Verdict JSON shape**:
  ```
  {
    "ok": bool,
    "missing": [string],
    "misplaced": [string],
    "unfinished": [string],
    "spec_issues": {
      "ambiguous": [string],
      "contradicts_reality": [string]
    },
    "fix_target": "impl" | "spec" | "both" | "escalate",
    "notes": string
  }
  ```
- **Depth**:
  - `standard` = 1 architect pass.
  - `complex` = up to 3 deeper-context passes если architect unsure после первого pass.
- **Cap**: `MAX_ARCH_ROUNDS = 3`. 4-й проход → spec bug, escalate.
- **/architect read-only**: НЕ patches files. Возвращает verdict caller'у; caller (operator) routes по `fix_target`.
- **Constitution reference**: invariants + role rights table в `~/.claude/skills/system-constitution/SKILL.md`. Architect operates within Architect role-rights row (read-only, spec-domain only).
- **Difference from /task**:
  - `/task` — patches inline + verify gate (`bun test`, `bunx tsc`).
  - `/architect` — read-only + `git diff` analysis. Без verify-gate (verdict не зависит от test pass).

## Usage

```
/architect [--depth=standard|complex] --spec=<path1>,<path2> --diff=<base..head> <task description>
```

Или packet form:

```
/architect --packet=<readme-path>#<packet-id> --base=<sha>
```

`--spec` mandatory (без spec docs архитектурного сравнения нет). `--diff` ИЛИ `--packet` — один из двух.

## Loop

1. **Parse args**: spec paths (mandatory), diff range OR packet ref, task description. Если spec отсутствует → fail-fast `Error: --spec required`.
2. **Read spec docs** full text. Если packet ref дан — extract packet block из README (JSON между ```json fence'ами).
3. **Read git diff** `base..head`. Empty diff → return `{ok:true, ..., notes:"empty diff — no architecture to review"}`.
4. **Spawn architect-Opus subagent**:
   - `Agent(subagent_type: "general-purpose", model: "opus", prompt: spec_content + packet_block + diff + ARCHITECT_PROMPT_TEMPLATE)`.
   - Read-only contract — subagent prompt инструктирует не делать edits.
5. **Parse JSON** verdict. Parse fail → 1 retry с reminder `"strict JSON only, no markdown, no prose"`. Retry fail → return `{ok:false, notes:"parse_error", fix_target:"escalate"}`.
6. **`ok=true`** → return success verdict to caller.
7. **`ok=false`** → return verdict; caller routes по `fix_target`.
8. **Depth=complex**: если verdict notes signal "unsure" (architect hedged) → re-spawn architect с extended read_context (related code files, ADRs из `docs/adr/`, completed docs). Cap `MAX_ARCH_ROUNDS = 3` passes total.

## ARCHITECT_PROMPT_TEMPLATE

```text
You are the architect for <project>. Read-only.

Source of truth:
<spec docs full content>

Packet (если есть):
<packet JSON block>

Diff:
<git diff output>

Task description:
<task desc>

Compare implementation to architectural intent. Specifically:
1. Structural blocks missing → list each absent piece named in spec / packet goal / implementation notes.
2. Blocks placed in wrong layer/folder → cite spec layer rule + where code landed.
3. Tasks from packet goal not executed → bullet each goal item absent from diff.
4. Spec ambiguity → patterns where spec readable two ways.
5. Spec contradicts reality → spec demands impossible (lib API constraint, infra limit).

Decide fix_target:
- impl       → impl wrong, spec ok.
- spec       → spec wrong, impl is the right reality, doc should match.
- both       → impl wrong AND spec wrong (both need patches).
- escalate   → spec ambiguous/contradictory beyond doc-fix, needs human decision.

Output strict JSON only (no prose, no markdown fences):
{"ok": <bool>, "missing": [<string>], "misplaced": [<string>], "unfinished": [<string>], "spec_issues": {"ambiguous": [<string>], "contradicts_reality": [<string>]}, "fix_target": "impl"|"spec"|"both"|"escalate", "notes": <string>}
```

## Anti-patterns

- **Architect editing files** → contract violation. Architect must be read-only.
- **Architect mixing code-level nits с spec-level verdict** → that is critic's role, не architect's. Stay в spec domain.
- **Looping >3 passes** → not impl bug, spec bug. Escalate to human.
- **Architect generating new spec text inline** → architect signals `fix_target=spec`, operator patches docs separately.
