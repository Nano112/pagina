import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  // `e2e/.tmp/` is generated: fixture copies the specs write to, and a *built site* — bundled
  // third-party JS that has no business in our lint report. Gitignored for the same reason.
  { ignores: ["**/dist/**", "**/node_modules/**", "e2e/.tmp/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS Node scripts (the e2e host, the shell's CSS build step): the TS configs supply
    // Node's globals everywhere else, and these files are outside them, so `no-undef` needs the
    // handful they actually use.
    files: ["e2e/**/*.mjs", "packages/*/scripts/**/*.mjs"],
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
