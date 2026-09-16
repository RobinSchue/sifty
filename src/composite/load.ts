/**
 * Sifty — composite rules loader.
 *
 * The one file under src/composite/ that touches the file system; everything
 * else in this module takes an already-loaded `CompositeRules`.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { compositeRulesSchema, type CompositeRules } from "./rules.js";
import { findConfigDir } from "../criteria/load.js";
import { describeSchemaIssues } from "../criteria/schema.js";

export function loadCompositeRules(configPath?: string): CompositeRules {
  const path = configPath
    ? isAbsolute(configPath)
      ? configPath
      : resolve(process.cwd(), configPath)
    : resolve(findConfigDir(), "composite.json");

  if (!existsSync(path)) {
    throw new Error(`No composite rules file (expected at ${path})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }

  const result = compositeRulesSchema.safeParse(parsed);
  if (!result.success) {
    const problems = describeSchemaIssues(result.error);
    throw new Error(`Invalid composite rules (${path}):\n  - ${problems.join("\n  - ")}`);
  }
  return result.data;
}
