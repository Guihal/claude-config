---
name: risk-tolerance-personal-machine
description: "User's risk tolerance for permission bypass and destructive actions on this machine"
metadata: 
  node_type: memory
  type: user
  originSessionId: 922f6e8b-9f5b-4601-9d13-48537f1e3db5
---

User runs this CachyOS machine as a personal box with low cost-of-error right now, and explicitly chose `permissions.defaultMode: "bypassPermissions"` in `~/.claude/settings.json` (2026-07-06) to kill the auto-mode classifier (found it slow and quota-hungry).

**Why:** if something breaks here, it's cheap to fix — no prod/client data at stake currently.

**How to apply:** don't push back on skipping the auto-mode classifier or loosening permissions on *this* machine. This does NOT transfer to a future work laptop — user said once employed, work will happen on a separate employer-issued laptop, where default caution (schema/security/destructive tiers from [[AGENTS.md]] risk-tier table) should apply again. If a session is clearly on a different machine/user (e.g. not `/home/penis`, or work-context signals), revert to normal caution and don't assume bypass is wanted.
