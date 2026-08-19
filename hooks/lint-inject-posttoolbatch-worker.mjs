import { parentPort, workerData } from "node:worker_threads";
import { runForFiles } from "./lint-inject/index.ts";

try {
  const report = await runForFiles(
    workerData.items,
    workerData.timings,
    undefined,
    "write",
    () => parentPort?.postMessage({ type: "plans-resolved" }),
  );
  parentPort?.postMessage({ type: "report", report });
} catch (error) {
  parentPort?.postMessage({ type: "error", error: error?.stack ?? String(error) });
}
