/**
 * Sifty — JSON formatting for a composite review.
 *
 * Serializes exactly what `reviewComposite()` returned — review, error,
 * usage — mirroring json.ts's `{ report, failures, aiError, usage }` for a
 * single file. Excerpts are already redacted by then.
 */
import type { CompositeResult } from "../composite/types.js";

export function formatCompositeJson(result: CompositeResult): string {
  const payload: CompositeResult = {
    review: result.review,
    error: result.error,
    usage: result.usage,
  };
  return JSON.stringify(payload, null, 2);
}
