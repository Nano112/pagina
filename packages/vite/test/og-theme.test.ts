/**
 * Baking a palette out of stylesheets.
 *
 * The one thing worth pinning here is that the built-in defaults are not a *second* copy of the
 * token contract that can drift from the first. They exist for a host shell that ships no
 * `tokens.css`; when there is one, the file wins, and the test below reads the real file to prove
 * the two agree today.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { DEFAULT_DARK, DEFAULT_LIGHT, applyTokens, readPgTokens, resolveCardPalette } from "../src/og-theme.js";
import type { Diagnostic } from "@pagina/core";

const tokensCssPath = new URL("../../shell-static/client/tokens.css", import.meta.url).pathname;

describe("readPgTokens", () => {
  it("reads the light values from ordinary blocks and the dark ones from the dark selector", async () => {
    const css = await readFile(tokensCssPath, "utf8");
    expect(readPgTokens(css, "light")["--pg-bg"]).toBe("#ffffff");
    expect(readPgTokens(css, "dark")["--pg-bg"]).toBe("#14161a");
    expect(readPgTokens(css, "light")["--pg-accent"]).toBe("#3b5bdb");
    expect(readPgTokens(css, "dark")["--pg-accent"]).toBe("#7c9bff");
  });

  it("ignores a declaration that is commented out", () => {
    expect(readPgTokens(":root { /* --pg-bg: #000; */ --pg-fg: #111; }", "light"))
      .toEqual({ "--pg-fg": "#111" });
  });

  it("resolves a stylesheet with no dark block to its light values in either scheme", () => {
    expect(readPgTokens(":root { --pg-accent: #a00; }", "dark")).toEqual({});
  });
});

describe("the built-in defaults", () => {
  it("say what `tokens.css` says", async () => {
    const css = await readFile(tokensCssPath, "utf8");
    const light = applyTokens(DEFAULT_LIGHT, readPgTokens(css, "light"), "tokens.css", []);
    const dark = applyTokens(DEFAULT_DARK, readPgTokens(css, "dark"), "tokens.css", []);
    expect(light).toEqual(DEFAULT_LIGHT);
    expect(dark).toEqual(DEFAULT_DARK);
  });
});

describe("applyTokens", () => {
  it("replaces only the roles the stylesheet names", () => {
    const out = applyTokens(DEFAULT_LIGHT, { "--pg-accent": "#a01010" }, "the article", []);
    expect(out.accent).toBe("#a01010");
    expect(out.bg).toBe(DEFAULT_LIGHT.bg);
  });

  it("expands a three-digit hex, so the mark's alphas have channels to mix", () => {
    expect(applyTokens(DEFAULT_LIGHT, { "--pg-accent": "#F0A" }, "x", []).accent).toBe("#ff00aa");
  });

  it("keeps the default and says so for a colour it cannot bake", () => {
    const diagnostics: Diagnostic[] = [];
    const out = applyTokens(DEFAULT_LIGHT, { "--pg-accent": "oklch(0.6 0.2 250)" }, "the article's theme", diagnostics);
    expect(out.accent).toBe(DEFAULT_LIGHT.accent);
    expect(diagnostics[0]).toMatchObject({ severity: "warning", code: "og-token-unbakeable" });
    expect(diagnostics[0]!.message).toContain("oklch(0.6 0.2 250)");
  });
});

describe("resolveCardPalette", () => {
  it("layers the contract, then the article, then the page", async () => {
    const { palette } = await resolveCardPalette(process.cwd(), "light", {
      tokensCss: ":root { --pg-accent: #111111; --pg-bg: #222222; }",
    });
    expect(palette.accent).toBe("#111111");
    expect(palette.bg).toBe("#222222");
    // Untouched roles keep the built-in default rather than becoming undefined.
    expect(palette.muted).toBe(DEFAULT_LIGHT.muted);
  });

  it("says why a remote theme cannot be baked instead of fetching it", async () => {
    const { palette, diagnostics } = await resolveCardPalette(process.cwd(), "light", {
      articleTheme: "https://cdn.example/theme.css",
    });
    expect(palette).toEqual(DEFAULT_LIGHT);
    expect(diagnostics[0]).toMatchObject({ code: "og-theme-remote" });
  });

  it("says so when the article names a stylesheet that is not there", async () => {
    const { diagnostics } = await resolveCardPalette(process.cwd(), "light", { articleTheme: "no/such.css" });
    expect(diagnostics[0]).toMatchObject({ code: "og-theme-missing" });
  });
});
