---
name: constitution-patch
description: Disciplined procedure for mutating ~/.claude/skills/system-constitution/SKILL.md. Use ONLY when explicit reflection signal indicates constitution rule gap (new loop, missing limit, role-rights extension, evidence-based threshold change). Always /task --depth=complex (constitution-for-constitution rigor). Architect approval mandatory. Operator gate forbids mid-wave mutation. Triggers - patch constitution, update constitution, constitution drift, /constitution-patch.
---

# Constitution Patch

Constitution = system genome. Mutations rare. This skill = procedure для safe mutation.

Meta-level: constitution-для-constitution. Если собираешься менять `~/.claude/skills/system-constitution/SKILL.md` — проходи через эту процедуру. Constitution holds invariants; tactical skills (operator-orchestrator, architect) реализуют их; constitution декларирует. Безопасная мутация invariant-слоя требует жёсткой дисциплины.

## When to use

**Use** (запускать constitution-patch):

- New loop discovered (reflection signal → add row в 5/6-loop feedback table).
- Limit not covered (incident → new row в Limits & treatment table).
- Role rights gap (audit reveals cross-role boundary needed).
- Strategic / Backlog review evidence → threshold change (e.g. `STRATEGIC_REVIEW_EVERY=3 → 5`).
- Adding / extending review procedure (как Backlog drift review поверх Strategic).

**Skip** (use direct Edit вместо constitution-patch flow):

- Spelling / grammar / typo fixes.
- Adding example (если не меняет invariant).
- Reformatting (Markdown style only).

**Defer** (wait — не сейчас):

- Mid-wave drift signal → wait until wave done (constitution mutation mid-wave breaks operator determinism).

## Pre-flight

1. **Operator state check**: НЕ должна active wave. Mid-wave mutation forbidden. Если operator state shows wave в progress → defer constitution patch до wave end. Detection — см. Procedure step 4 (lite subagent).
2. **Reflection signal source documented**: текст reflection / incident link / data evidence (RLM meta JSONs, backlog review output, post-mortem) — должен попасть в commit message как `refs: <source>`. Без cited trigger constitution не мутирует.
3. **Depth**: ВСЕГДА `--depth=complex` (MAX_DEPTH_PLAN=6, MAX_DEPTH_IMPL=10, plan_revisits_cap=2). Standard depth — недостаточная rigor для constitution-level changes.

## Procedure

1. **Compose patch design**: section changes (add / modify), exact bullet text, table rows, frontmatter `description` если расширяется. Формулировки финальные — design передаётся /task as-is.
2. **Launch `/task --depth=complex`** с design as TASK_TEXT:
   - Plan phase — full plan + Opus critic + iterate (MAX_DEPTH_PLAN=6).
   - Implementation phase — Edit/Write + critic + iterate (MAX_DEPTH_IMPL=10).
   - Verify gate UNAVAILABLE (markdown file — не triggers TS/bash/python/sh/vue gate).
   - /task возвращает `ok` / `maxDepth` / `parse_error`.
3. **Architect mandatory gate** (после /task ok):
   - Spawn `/architect --spec=<constitution path before patch> --diff=HEAD~1..HEAD '<reason for change>'`.
   - Architect verdict outcomes:
     - `ok=true` → proceed step 4.
     - `fix_target=spec` → further polish needed; loop /task снова с feedback.
     - `fix_target=impl` → /task снова (constitution patch implementation неверна).
     - `fix_target=escalate` → STOP, surface verdict + notes to user.
4. **Operator gate (lite)**:
   - Spawn read-only subagent (`general-purpose`, Sonnet) с prompt: `"Check git log last 5 commits. Active wave (packet IDs in commits)? List any HR-XX / refactor-NN / similar pattern. Return JSON {active_wave: bool, packets: [string], reasoning: string}."`
   - Если `active_wave=true` → escalate, defer constitution patch до wave end. Constitution commit не должен попасть в активную wave последовательность.
5. **Commit** separate commit:
   - Format: `constitution: <one-line trigger> (refs: <reflection source path или "user-reflection-2026-MM-DD">)`.
   - Examples:
     - `constitution: add backlog drift review loop (refs: user-reflection-2026-05-16)`.
     - `constitution: tighten STRATEGIC_REVIEW_EVERY to 5 (refs: docs/audits/wave-hermes-rails-retro.md)`.
6. **Reload check**: confirm skill loader recognizes updated constitution в available skills list. Способ: grep updated `description` substring в Skill tool output после next user prompt, OR `test -f ~/.claude/skills/system-constitution/SKILL.md` + manual frontmatter parse. Выбрать lighter weight.

## Restrictions

- **Patch only**: `~/.claude/skills/system-constitution/SKILL.md` + tactical skills (`operator-orchestrator`, `architect`) если им требуется reference update под new constitution rule. Никаких других файлов.
- **Diff budget**: ≤100 LOC per single patch session. Больше → split into 2+ patches с separate commits и separate /task runs.
- **Existing rules deletion**: requires explicit deprecation marker `[DEPRECATED YYYY-MM-DD: <reason>]` сохранённый в text ≥1 wave перед removal. Direct deletion forbidden.
- **Canonical loop label renaming forbidden**: `5-loop`, `6-loop` — стабильные референсы для audit. Расширение допустимо (5→6 expand). Renaming (e.g. `5-loop → multi-loop`) — нет (breaks downstream references).
- **Constitution frontmatter `name:`** unchangeable. **`description:`** обновляется только при добавлении / удалении значимых sections (новый loop, новый Limits row); косметические правки text — не trigger description update.

## Anti-patterns

- **Patching constitution mid-wave** → operator determinism breaks; current wave packets могут получить partially-old / partially-new rules. Complete wave first.
- **Using `/task --depth=standard`** для constitution → insufficient rigor; constitution-level changes требуют complex (max critic iterations).
- **Bypassing architect gate "because change is small"** → constitution = source of truth; даже single-bullet change проходит architect. Audit trail mandatory.
- **Bundling multiple unrelated rule changes** в один patch → audit trail unclear; reflection sources перепутаны; rollback complicated. Split per concern.
- **Patching constitution для temporary workaround** → tactical skills carry workarounds; constitution holds invariants only. "Временно нужно нарушить" → patch tactical skill, не constitution.

## Acceptance per patch

- **YAML frontmatter parses**: line 1 `---`, closing `---` ровно один, no unbalanced colons mid-value, no broken structure.
- **Skill loader recognizes constitution**: `test -f ~/.claude/skills/system-constitution/SKILL.md` AND optional `grep -q "<updated description substring>"` в available skills list (если description менялся).
- **/architect verdict** `ok=true` OR `fix_target=spec` (signals further polish, не fail). `fix_target=impl|escalate` = patch fails.
- **Operator gate passed**: no active wave detected via lite subagent check.
- **Line count constitution ≤300**: `wc -l ~/.claude/skills/system-constitution/SKILL.md`.
