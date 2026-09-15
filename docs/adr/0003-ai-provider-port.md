# 0003. AI provider port

## Status

Accepted

## Context

Sifty's non-mechanical checks (concrete instructions, contradictions,
project context, scope, whether an output constraint makes sense) and its
fix-prompt generation both need a model call. The first implementation
called the Anthropic SDK directly from `src/engine/ai.ts`: the SDK's own
request/response types (`ParseableMessageCreateParams`, `parsed_output`)
were the engine's AI abstraction, the model id and `zodOutputFormat` calls
lived next to the prompt-building and retry logic, and the fix-prompt
generator (a different concern — writing a helpful prompt, not scoring) was
bundled into the same file because both needed the same SDK plumbing.

The product intends to support other providers — an EU-hosted endpoint, a
self-hosted model, a local one — without touching scoring, and to report
token usage (`--show-tokens`), which the original design had no place for
(the port didn't return usage at all).

## Decision

`src/engine/ai-provider.ts` defines the only interface the engine and
`src/fixprompt/generate.ts` depend on:

```ts
interface AiProvider {
  complete<T>(request: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxTokens: number;
  }): Promise<{ output: unknown; usage?: TokenUsage }>;
}
```

No model name, no SDK type, no HTTP concern — a request in, an unvalidated
output plus optional usage out. The caller (`src/engine/ai-checks.ts` for
the bundled checks, `src/fixprompt/generate.ts` for the fix prompt) still
owns prompt construction, Zod validation of the response, and — for the
bundled checks — the one-retry-on-malformed-response logic; none of that is
provider-specific.

`src/providers/anthropic.ts` is the only file allowed to import
`@anthropic-ai/sdk` (enforced by `eslint.config.js`'s `no-restricted-imports`
rule, verified by deliberately violating it and confirming lint catches it).
It builds the real request, calls `zodOutputFormat`, and maps the SDK's
`usage.{input,output}_tokens` onto `TokenUsage`. Model selection is a
provider-construction concern, not part of the port: the composition root
(`src/cli.ts`) builds one `AnthropicProvider` per model it needs (haiku for
the bundled checks, sonnet for the fix prompt) and passes the right one to
each caller.

## Consequences

A second provider is one new file under `src/providers/` plus a flag in
`src/cli.ts` — `src/engine/**`, `src/fixprompt/**`, their tests, and every
score stay untouched, which is what makes this cheap. Tests fake the port
(`AiProvider["complete"]`) instead of the SDK's client shape, and
`src/providers/anthropic.test.ts` is the one place that tests the adapter's
own request/response mapping via a test-seam `client` option, without
touching the network.

The cost: two AI-shaped modules now exist at the engine's edge
(`ai-checks.ts`, `fixprompt/generate.ts`) instead of one, since they were
split along their actual responsibilities (scoring vs. writing a prompt) at
the same time the port was introduced. Both are thin — the port already
carries the shared plumbing — so this is not considered a meaningful added
surface.
