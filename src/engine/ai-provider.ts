/**
 * Sifty — AI provider port.
 *
 * The engine asks for ONE structured completion at a time and knows nothing
 * about which model, vendor, or transport answers it. `src/providers/*` are
 * the only files allowed to import an AI SDK (enforced by eslint.config.js);
 * everything in `src/engine/**` and `src/fixprompt/**` talks to this
 * interface only. Swapping providers (EU cloud, self-hosted, local) means
 * adding one file under `src/providers/` and wiring it in the CLI — no
 * change to prompt-building, validation, retry logic, or scoring.
 */
import type { z } from "zod";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiCompletionRequest<T> {
  system: string;
  user: string;
  /** Guides structured output on the provider side; the caller still validates the result itself. */
  schema: z.ZodType<T>;
  maxTokens: number;
}

export interface AiCompletionResult {
  /** Not yet validated against `schema` — the caller does that (see ai-request.ts, fixprompt/generate.ts). */
  output: unknown;
  /** Absent when the provider does not report usage, or none was requested. */
  usage?: TokenUsage | undefined;
}

export interface AiProvider {
  complete<T>(request: AiCompletionRequest<T>): Promise<AiCompletionResult>;
}
