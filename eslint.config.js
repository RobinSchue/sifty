import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

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
    // Wave 2 (AI provider port): the SDK stays behind src/providers/** so a
    // second provider (EU cloud, self-hosted, local) never touches the
    // engine — see src/engine/ai-provider.ts for the port it talks to instead.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*"],
              message:
                "Import the Anthropic SDK only in src/providers/** — everywhere else, depend on the AiProvider port (src/engine/ai-provider.ts).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/providers/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
