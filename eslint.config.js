import js from "@eslint/js";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default [
  js.configs.recommended,
  prettierRecommended,
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      // The published baseline `test/benchmark.js` downloads — someone else's
      // build output, and not ours to lint.
      "test/.cache/**",
    ],
  },
  {
    // The benchmark is a standalone Node script, not library code.
    files: ["test/benchmark.js"],
    languageOptions: {
      globals: {
        URL: "readonly",
        console: "readonly",
        fetch: "readonly",
        performance: "readonly",
        process: "readonly",
      },
    },
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        TextDecoder: "readonly",
      },
    },
    rules: {
      curly: ["error", "all"],
      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
    },
  },
];
