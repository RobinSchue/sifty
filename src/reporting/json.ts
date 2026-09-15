/**
 * Sifty — JSON report formatting.
 *
 * The other supported `--format`, alongside terminal.ts. Serializes exactly
 * what `analyze()` returned — report, failures, aiError, usage — so a
 * consumer (a script, a web UI, CI) gets the same information a human sees
 * in the terminal, without re-deriving it from formatted text.
 */
import type { AnalyzeResult } from "../engine/runner.js";

export function formatJson(result: AnalyzeResult): string {
  const payload: AnalyzeResult = {
    report: result.report,
    failures: result.failures,
    aiError: result.aiError,
    usage: result.usage,
  };
  return JSON.stringify(payload, null, 2);
}
