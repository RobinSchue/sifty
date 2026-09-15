import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Dependency-direction rules (Waves 2-3 of docs/architecture/reviews/…-baseline.md;
 * see docs/architecture/dependency-rules.md for the human-readable version).
 *
 * ESLint flat config resolves a rule per matched file from the LAST config
 * block that sets it — blocks do NOT merge their options. So every block
 * below targets a distinct, non-overlapping slice of src/** (one directory,
 * or "everything else"), and each block's `no-restricted-imports` entry is
 * self-contained — it repeats the SDK ban rather than depending on some
 * earlier "baseline" block to still apply. Test files (*.test.ts) are
 * exempt everywhere: they legitimately cross these boundaries to build
 * fixtures (e.g. src/engine/golden.test.ts loads real criteria).
 */

const SDK_BAN = {
  group: ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*"],
  message:
    "Import the Anthropic SDK only in src/providers/** — everywhere else, depend on the AiProvider port (src/engine/ai-provider.ts).",
};

const NODE_IO_BAN = {
  group: ["node:fs", "node:path", "node:url"],
  message: "This layer stays free of file-system I/O — that belongs in src/cli.ts.",
};

const CLI_ONLY_BAN = {
  group: ["chalk", "commander", "dotenv"],
  message:
    "chalk/commander/dotenv are composition-root and presentation concerns — import them only in src/cli.ts (chalk is also allowed under src/reporting/**).",
};

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    // R2: the engine is pure — no I/O, no CLI parsing, no terminal styling,
    // no direct process access (process.env/cwd/exitCode).
    files: ["src/engine/**/*.ts"],
    ignores: ["src/engine/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [SDK_BAN, NODE_IO_BAN, CLI_ONLY_BAN] }],
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "src/engine/** must not read process.env — pass values in as parameters.",
        },
        {
          object: "process",
          property: "cwd",
          message: "src/engine/** must not resolve paths against cwd — that is a cli.ts concern.",
        },
        {
          object: "process",
          property: "exitCode",
          message:
            "src/engine/** must not set the exit code — return a Report and let cli.ts decide.",
        },
      ],
    },
  },
  {
    // R5: criteria describes and loads criteria data; it must not import the
    // engine (F-14 — this used to import engine/measures.js), providers,
    // reporting or fixprompt.
    files: ["src/criteria/**/*.ts"],
    ignores: ["src/criteria/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            SDK_BAN,
            CLI_ONLY_BAN,
            {
              group: ["../engine/*", "../providers/*", "../reporting/*", "../fixprompt/*"],
              message:
                "src/criteria/** must not depend on the engine, providers, reporting or fixprompt.",
            },
          ],
        },
      ],
    },
  },
  {
    // R6: reporting turns a Report into text — it may reference the engine's
    // TYPES (the Report/AnalyzeResult shape) but must not call engine code,
    // touch the file system, parse CLI args, or depend on criteria/providers.
    // chalk is allowed here (terminal.ts needs it); commander/dotenv are not.
    files: ["src/reporting/**/*.ts"],
    ignores: ["src/reporting/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            SDK_BAN,
            NODE_IO_BAN,
            { group: ["commander", "dotenv"], message: CLI_ONLY_BAN.message },
            {
              group: ["../criteria/*", "../providers/*"],
              message:
                "src/reporting/** formats a Report — it has no reason to load criteria or reach a provider.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../engine/*"],
              allowTypeImports: true,
              message:
                "src/reporting/** may import engine TYPES only (`import type { Report }`) — never engine code.",
            },
          ],
        },
      ],
    },
  },
  {
    // fixprompt/ sits at the same edge as reporting/: it turns a Report into
    // text (a prompt) via the AiProvider port, nothing more.
    files: ["src/fixprompt/**/*.ts"],
    ignores: ["src/fixprompt/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [SDK_BAN, NODE_IO_BAN, CLI_ONLY_BAN] }],
    },
  },
  {
    // The composition root: everything is allowed except the SDK itself —
    // even here, AI calls go through src/providers/, never the SDK directly.
    files: ["src/cli.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [SDK_BAN] }],
    },
  },
  {
    // Everything else at the top level (index.ts, report.types.ts) and test
    // fixtures: no SDK, no chalk/commander/dotenv — none of them format for
    // a terminal or parse CLI args.
    files: ["src/*.ts", "src/testing/**/*.ts"],
    ignores: ["src/cli.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [SDK_BAN, CLI_ONLY_BAN] }],
    },
  },
  {
    // The SDK's actual home — no restriction here.
    files: ["src/providers/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
