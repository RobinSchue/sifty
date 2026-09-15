/**
 * Sifty — composition root.
 *
 * The only place that touches the file system, reads environment variables,
 * parses CLI flags, and prints. Everything it calls — `loadCriteria`,
 * `analyze`, `generateFixPrompt`, `createAnthropicProvider` — is a pure or
 * side-effect-scoped function that could just as well be called from a web
 * UI. Imported by src/index.ts (the npm bin entry) — see that file for why
 * they're split.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import chalk from "chalk";
import { Command, Option } from "commander";
import { config as loadEnv } from "dotenv";

import { loadCriteria } from "./criteria/load.js";
import type { TokenUsage } from "./engine/ai-provider.js";
import { measures } from "./engine/measures.js";
import { analyze } from "./engine/runner.js";
import { generateFixPrompt } from "./fixprompt/generate.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { formatJson } from "./reporting/json.js";
import { formatTerminal } from "./reporting/terminal.js";

// `quiet` — dotenv 17 otherwise prints an info line to stdout, right into the report.
loadEnv({ quiet: true });

// Works in dev (src/cli.ts) and after a build (dist/cli.js) — both sit one
// directory below the package root, same as criteria/load.ts's findConfigDir().
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = JSON.parse(readFileSync(resolve(HERE, "../package.json"), "utf8")) as {
  version: string;
};

/** Higher-quality tier for the fix prompt — a human reads this directly, worth the extra cost. */
const FIX_PROMPT_MODEL = "claude-sonnet-5";

const program = new Command();

program
  .name("sifty")
  .description(
    "Evaluates instruction, skill, and prompt files for AI tools (Copilot, Claude, ...).",
  )
  .version(PACKAGE_JSON.version);

program
  .command("check")
  .description("Checks a single file")
  .argument("<file>", "Path to the file to check")
  .option("-t, --tool <tool>", "Target tool (e.g. copilot)", "copilot")
  .option("-p, --preset <preset>", "Scoring preset (e.g. balanced, cost, security)")
  .option("-c, --config <path>", "Path to a custom criteria config, bypassing config/<tool>.json")
  .option("--no-ai", "Skip the AI checks and score mechanically only")
  .option(
    "--generate-fix-prompt",
    "Generate an AI-driven optimization prompt for the fixes found (requires AI checks; ignored with --no-ai and with --format json)",
  )
  .option(
    "--show-tokens",
    "Print input/output token usage for each AI call made (redundant with --format json, which already includes it)",
  )
  .addOption(
    new Option(
      "--fix-prompt <style>",
      "Fix prompt style: short (brief list) or full (complete prompt)",
    )
      .choices(["short", "full"])
      .default("full"),
  )
  .addOption(
    new Option("--format <format>", "Output format: terminal (human-readable) or json")
      .choices(["terminal", "json"])
      .default("terminal"),
  )
  .action(
    async (
      file: string,
      options: {
        tool: string;
        preset?: string;
        config?: string;
        ai: boolean;
        generateFixPrompt?: boolean;
        fixPrompt: "short" | "full";
        showTokens?: boolean;
        format: "terminal" | "json";
      },
    ) => {
      if (!existsSync(file)) {
        console.error(chalk.red(`File not found: ${file}`));
        process.exitCode = 1;
        return;
      }

      // Read once, reused to build both AI providers below (bundled checks, fix prompt).
      const apiKey = process.env["ANTHROPIC_API_KEY"];
      if (options.ai && !apiKey) {
        console.error(
          chalk.dim("AI checks skipped: ANTHROPIC_API_KEY is not set — mechanical checks only."),
        );
      }
      const checksProvider = options.ai && apiKey ? createAnthropicProvider({ apiKey }) : undefined;

      let content: string;
      let result: Awaited<ReturnType<typeof analyze>>;
      try {
        content = readFileSync(file, "utf8");
        const config = loadCriteria(options.tool, options.config, {
          measureTypes: Object.keys(measures),
        });
        result = await analyze(
          { path: file, content },
          {
            config,
            ...(options.preset ? { preset: options.preset } : {}),
            ...(checksProvider ? { provider: checksProvider } : {}),
          },
        );
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
        return;
      }

      if (options.format === "json") {
        console.log(formatJson(result));
        if (result.report.blockers.length > 0) process.exitCode = 1;
        return;
      }

      console.log(formatTerminal(result.report));

      if (result.aiError) {
        console.error(
          chalk.yellow(`AI checks skipped: ${result.aiError} — mechanical checks only.`),
        );
      }

      for (const failure of result.failures) {
        console.error(chalk.dim(`  (${failure.checkId}: ${failure.message} — skipped)`));
      }

      let fixPromptUsage: TokenUsage | undefined;

      // --no-ai means no AI call at all, full stop — the fix prompt is AI-generated
      // too, so it follows the same flag instead of quietly making its own request.
      if (options.generateFixPrompt && options.ai) {
        const fixPromptProvider = apiKey
          ? createAnthropicProvider({ apiKey, model: FIX_PROMPT_MODEL })
          : undefined;

        const promptResult = await generateFixPrompt({
          report: result.report,
          fileContent: content,
          fileKind: result.report.fileKind,
          tool: options.tool,
          ...(fixPromptProvider ? { provider: fixPromptProvider } : {}),
        });
        fixPromptUsage = promptResult.usage;

        if (promptResult.error) {
          console.error(chalk.dim(`Fix prompt generation skipped: ${promptResult.error}`));
        } else {
          const style = options.fixPrompt === "short" ? promptResult.short : promptResult.full;
          if (style) {
            console.log();
            console.log(chalk.bold("Proposed fix:"));
            console.log(style);
          }
        }
      }

      if (options.showTokens) {
        printTokenUsage(result.usage, fixPromptUsage);
      }

      if (result.report.blockers.length > 0) {
        process.exitCode = 1;
      }
    },
  );

function printTokenUsage(checksUsage?: TokenUsage, fixPromptUsage?: TokenUsage): void {
  console.log();
  console.log(chalk.bold("Token usage:"));
  if (!checksUsage && !fixPromptUsage) {
    console.log(chalk.dim("  no AI call was made"));
    return;
  }
  if (checksUsage) {
    console.log(`  checks:     ${checksUsage.inputTokens} in / ${checksUsage.outputTokens} out`);
  }
  if (fixPromptUsage) {
    console.log(
      `  fix prompt: ${fixPromptUsage.inputTokens} in / ${fixPromptUsage.outputTokens} out`,
    );
  }
}

await program.parseAsync();
