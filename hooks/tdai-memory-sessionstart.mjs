#!/usr/bin/env node
// tdai-memory-sessionstart.mjs — SessionStart hook. Only resets the persona
// injection cadence so the first prompt of a fresh/resumed/compacted session
// carries the persona again.
import { readStdinJson, resetPersonaCadence } from "/home/penis/.claude/hooks/_tdai-helper.mjs";

try {
  resetPersonaCadence(readStdinJson());
} catch (e) {
  process.stderr.write(`[tdai-memory] persona cadence reset failed: ${e instanceof Error ? e.message : e}\n`);
}
