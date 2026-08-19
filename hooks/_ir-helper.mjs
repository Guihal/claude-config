// _ir-helper.mjs — shared helper for injection-rules hooks
import { readFileSync } from "node:fs";

export function readStdinJson() {
  return JSON.parse(readFileSync(0, "utf8"));
}

// maxChars: пер-тиковые хуки живут в 2000, SessionStart отдаёт тела send_on_start
// правил разом и просит больше.
export function emitHook(eventName, body, maxChars = 2000) {
  if (!body) {
    process.stdout.write("");
    return;
  }
  const text = String(body);
  // Резать молча нельзя: именно так нудж task-list терялся на загруженных ходах.
  if (text.length > maxChars) {
    process.stderr.write(
      `[injection-rules] ${eventName}: truncated ${text.length} → ${maxChars} chars\n`,
    );
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: text.slice(0, maxChars),
      },
    }),
  );
}
