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
      "./tmp-*",
    ],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        TextDecoder: "readonly",
        process: "readonly",
      },
    },
    rules: {
      curly: ["error", "all"],
      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
    },
  },
];
