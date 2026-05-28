import js from "@eslint/js";
import globals from "globals";

/** Browser-frontend lint; TypeScript wordt gedekt door npm run typecheck. */
export default [
  js.configs.recommended,
  {
    files: ["public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
