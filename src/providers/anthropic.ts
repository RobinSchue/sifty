/**
 * Sifty — Anthropic AI provider.
 *
 * The ONLY file in this repository allowed to import `@anthropic-ai/sdk`
 * (enforced by eslint.config.js's no-restricted-imports rule). Implements
 * the engine's `AiProvider` port (src/engine/ai-provider.ts) — everything
 * SDK-specific (the client, the model id, `zodOutputFormat`, how usage is
 * reported) lives here and nowhere else.
 */
import Anthropic, { type ParseableMessageCreateParams } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "../engine/ai-provider.js";

/** Narrows the real SDK client down to what this adapter calls — also the test seam (see `client` below). */
interface AnthropicMessagesClient {
  messages: {
    parse(request: ParseableMessageCreateParams): Promise<{
      parsed_output: unknown;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Defaults to DEFAULT_MODEL. Pass the sonnet model for higher-quality, non-bundled calls (e.g. the fix prompt). */
  model?: string;
  /** Test seam — inject a fake client instead of constructing a real `Anthropic`. */
  client?: AnthropicMessagesClient;
}

/** Cost-efficient default for the bundled scoring call; override per call site via `model`. */
export const DEFAULT_MODEL = "claude-haiku-4-5";

export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  return {
    async complete<T>(request: AiCompletionRequest<T>): Promise<AiCompletionResult> {
      const response = await client.messages.parse({
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        output_config: { format: zodOutputFormat(request.schema) },
      });

      return {
        output: response.parsed_output,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}
