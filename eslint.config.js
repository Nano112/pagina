import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS Node scripts under `e2e/`: the TS configs supply Node's globals everywhere else,
    // and these files are outside them, so `no-undef` needs the handful they actually use.
    files: ["e2e/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly", fetch: "readonly" },
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["node:*", "fs", "path", "os", "url", "child_process"], message: "@pagina/core is environment-agnostic; inject a ContentFs instead." }] }],
    },
  },
  {
    files: ["packages/editor/src/store/**/*.ts", "packages/editor/src/ui/**/*.ts", "packages/editor/src/ui/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["node:*", "fs", "path", "os", "url", "child_process", "vite", "vite/*"], message: "The editor is backend-agnostic: talk to an ArticleBackend, not to the filesystem or Vite." }] }],
    },
  },
);
