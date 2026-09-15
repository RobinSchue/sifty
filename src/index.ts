#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import chalk from "chalk";
import { Command, Option } from "commander";
import { config as loadEnv } from "dotenv";

import { analyzeFile } from "./engine/runner.js";
import { generateFixPrompt } from "./engine/ai.js";
import { formatReport } from "./reporting/format.js";

// `quiet` — dotenv 17 otherwise prints an info line to stdout, right into the report.
loadEnv({ quiet: true });

// Works in dev (src/index.ts) and after a build (dist/index.js) — both sit one
// directory below the package root, same as config/load.ts's findConfigDir().
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = JSON.parse(readFileSync(resolve(HERE, "../package.json"), "utf8")) as {
  version: string;
};

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
    "Generate an AI-driven optimization prompt for the fixes found (requires AI checks; ignored with --no-ai)",
  )
  .addOption(
    new Option(
      "--fix-prompt <style>",
      "Fix prompt style: short (brief list) or full (complete prompt)",
    )
      .choices(["short", "full"])
      .default("full"),
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
      },
    ) => {
      if (!existsSync(file)) {
        console.error(chalk.red(`File not found: ${file}`));
        process.exitCode = 1;
        return;
      }

      // Read once, reused for both the bundled AI checks and the fix-prompt call below.
      const apiKey = process.env["ANTHROPIC_API_KEY"];
      if (options.ai && !apiKey) {
        console.error(
          chalk.dim("AI checks skipped: ANTHROPIC_API_KEY is not set — mechanical checks only."),
        );
      }

      let result: Awaited<ReturnType<typeof analyzeFile>>;
      try {
        result = await analyzeFile(file, {
          tool: options.tool,
          ...(options.preset ? { preset: options.preset } : {}),
          ...(options.config ? { configPath: options.config } : {}),
          ...(options.ai && apiKey ? { ai: { apiKey } } : {}),
        });
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
        return;
      }

      console.log(formatReport(result.report));

      if (result.aiError) {
        console.error(
          chalk.yellow(`AI checks skipped: ${result.aiError} — mechanical checks only.`),
        );
      }

      for (const failure of result.failures) {
        console.error(chalk.dim(`  (${failure.checkId}: ${failure.message} — skipped)`));
      }

      // --no-ai means no AI call at all, full stop — the fix prompt is AI-generated
      // too, so it follows the same flag instead of quietly making its own request.
      if (options.generateFixPrompt && options.ai) {
        const promptResult = await generateFixPrompt({
          report: result.report,
          fileContent: result.context.raw,
          fileKind: result.report.fileKind,
          tool: options.tool,
          ...(apiKey ? { apiKey } : {}),
        });

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

      if (result.report.blockers.length > 0) {
        process.exitCode = 1;
      }
    },
  );

await program.parseAsync();
