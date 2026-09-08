#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import matter from "gray-matter";
import { existsSync, readFileSync } from "node:fs";

const program = new Command();

program
  .name("sifty")
  .description(
    "Evaluates instruction, skill, and prompt files for AI tools (Copilot, Claude, ...)."
  )
  .version("0.1.0");

program
  .command("check")
  .description("Checks a single file")
  .argument("<file>", "Path to the file to check")
  .option("-t, --tool <tool>", "Target tool (e.g. copilot)", "copilot")
  .action((file: string, options: { tool: string }) => {
    if (!existsSync(file)) {
      console.error(chalk.red(`File not found: ${file}`));
      process.exitCode = 1;
      return;
    }

    const raw = readFileSync(file, "utf-8");
    const { data: frontmatter, content } = matter(raw);

    // Placeholder: the next steps will add mechanical checks
    // and then the bundled AI call.
    console.log(chalk.bold(`\nFile: ${file}`));
    console.log(chalk.dim(`Target tool: ${options.tool}`));
    console.log(chalk.dim(`Frontmatter fields: ${Object.keys(frontmatter).join(", ") || "(none)"}`));
    console.log(chalk.dim(`Length (characters): ${content.length}`));
    console.log(chalk.yellow("\n→ Base setup is running. Checks will follow in the next step."));
  });

program.parse();
