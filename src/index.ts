#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import { existsSync } from "node:fs";

import { analyzeFile } from "./engine/runner.js";
import { formatReport } from "./reporting/format.js";

const program = new Command();

program
  .name("sifty")
  .description(
    "Evaluates instruction, skill, and prompt files for AI tools (Copilot, Claude, ...).",
  )
  .version("0.1.0");

program
  .command("check")
  .description("Checks a single file")
  .argument("<file>", "Path to the file to check")
  .option("-t, --tool <tool>", "Target tool (e.g. copilot)", "copilot")
  .option("-p, --preset <preset>", "Scoring preset (e.g. balanced, cost, security)")
  .option("-c, --config <path>", "Path to a custom criteria config, bypassing config/<tool>.json")
  .action((file: string, options: { tool: string; preset?: string; config?: string }) => {
    if (!existsSync(file)) {
      console.error(chalk.red(`File not found: ${file}`));
      process.exitCode = 1;
      return;
    }

    let result: ReturnType<typeof analyzeFile>;
    try {
      result = analyzeFile(file, {
        tool: options.tool,
        ...(options.preset ? { preset: options.preset } : {}),
        ...(options.config ? { configPath: options.config } : {}),
      });
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
      return;
    }

    console.log(formatReport(result.report));

    for (const failure of result.failures) {
      console.error(chalk.dim(`  (${failure.checkId}: ${failure.message} — skipped)`));
    }

    if (result.report.blockers.length > 0) {
      process.exitCode = 1;
    }
  });

program.parse();
