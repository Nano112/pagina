import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  // `e2e/.tmp/` is generated: fixture copies the specs write to, and a *built site* — bundled
  // third-party JS that has no business in our lint report. Gitignored for the same reason.
  // `fixtures/` is not our code: it is other people's pages and programs, vendored verbatim so the
  // parser is tested against markup somebody actually wrote. Linting it would mean editing it.
  { ignores: ["**/dist/**", "**/node_modules/**", "e2e/.tmp/**", "fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS Node scripts (the e2e host, the shell's CSS build step): the TS configs supply
    // Node's globals everywhere else, and these files are outside them, so `no-undef` needs the
    // handful they actually use.
    files: ["e2e/**/*.mjs", "scripts/**/*.mjs", "packages/*/scripts/**/*.mjs"],
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
    // Tests get their scratch space from one place. `os.tmpdir()` is only as absolute as `$TMPDIR`
    // is, so `join(tmpdir(), …)` under a relative `$TMPDIR` writes to `process.cwd()` — which is
    // how a run of this suite once deposited 2,094 directories and 442 MB into an unrelated
    // repository. `tempDir()` allocates under an absolute root and is deleted for you.
    files: ["packages/*/test/**/*.{ts,tsx}", "e2e/**/*.{ts,mts}"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "node:os", importNames: ["tmpdir"], message: "Use `tempDir()` from `test/tmp.ts`: it is absolute, and it is cleaned up." }] }],
    },
  },
  {
    files: ["packages/editor/src/store/**/*.ts", "packages/editor/src/ui/**/*.ts", "packages/editor/src/ui/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["node:*", "fs", "path", "os", "url", "child_process", "vite", "vite/*"], message: "The editor is backend-agnostic: talk to an ArticleBackend, not to the filesystem or Vite." }] }],
    },
  },
);
