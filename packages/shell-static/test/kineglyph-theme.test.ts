/**
 * @vitest-environment jsdom
 *
 * A figure inherits the page it sits in.
 *
 * Kineglyph draws every fill as `var(--kg-color-<role>, <literal>)`: the literal is what the figure
 * was *drawn* with, and the variable is what the page paints it with. `pagina.css` takes that up and
 * points every `--kg-color-*` at the `--pg-*` that means the same thing, which is what makes a
 * diagram look like it belongs to the article around it.
 *
 * pagina used to publish an article's declared Kineglyph palette as `--kg-color-*` on `:root`,
 * unlayered, after the stylesheet — so a declaration beat everything: pagina's bridge, a host's own
 * mapping, and the page's theme. A light-declared figure stayed light on a dark site and the author
 * had no way to say "just follow the page" short of deleting the declaration. That block is gone.
 * A theme now claims the roles it *names*, and Kineglyph pins those on the drawing's own root, so a
 * declaration is scoped to what declared it and leaks nowhere.
 *
 * These assertions are the thing a reader can see: the colour a browser resolves for a figure's
 * paints on a real page carrying pagina's real stylesheet.
 */
import { describe, expect, it } from "vitest";
import { renderPageHtml, type ShellCtx } from "../src/template.js";
import { layerBody, read } from "./css-layers.js";
import type { RenderedArticle } from "@pagina/core";

const article: RenderedArticle = {
  diagnostics: [],
  manifest: {
    article: { slug: "t", title: "T", form: "docs", status: "published", visibility: "public", tags: [], rootHref: "/", coverOn: "root", kineglyph: { theme: "theme/kineglyph.mjs" } },
    nav: [{ title: "Home", href: "/" }],
    pages: { "/": { title: "Home", headings: [], breadcrumbs: [{ title: "Home", href: "/" }] } },
    figures: {}, assets: [],
  },
  pages: { "/": { path: "index.md", href: "/", title: "Home", html: "<p>hi</p>", headings: [], figures: [], links: [], frontMatter: {} } },
};

const ctx: ShellCtx = { base: "/", dev: false, clientUrl: "/_pagina/pagina.js", cssUrl: "/_pagina/pagina.css", kineglyphRuntimeUrl: "/_pagina/kineglyph.js" };

/** The palette the figure was drawn with — Nucleation's, which is where this was found. */
const DRAWN_CANVAS = "#f4f1e9";
const DRAWN_ACCENT = "#237f74";

/**
 * Builds the page in jsdom with pagina's real stylesheet, and reports the colour the browser
 * resolves for a figure's canvas and accent — the same `var(--kg-color-*, …)` the pre-rendered
 * frame and the live stage both carry. `hostCss` is a host's own sheet, loaded after pagina's.
 */
function paint(html: string, theme: "light" | "dark", hostCss = ""): { canvas: string; accent: string } {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
  // The `<link>` is not fetched by jsdom, so the sheet it names is inlined in its place — with the
  // page's own `<style>` kept in its original position, because the whole question is source order.
  //
  // The token layer goes in *unwrapped*: jsdom does not implement `@layer`, and a layered block it
  // cannot parse resolves to nothing at all, which would make every assertion below pass for the
  // wrong reason. Unwrapped, the bridge is an ordinary earlier `:root` rule — which is the weakest
  // form of what it really is, so anything shown to beat it here beats it on a real page too.
  document.head.innerHTML = `${head.replace(
    /<link rel="stylesheet"[^>]*>/,
    `<style>${layerBody(read("../client/tokens.css"), "pagina.tokens")!}</style>`,
  )}<style>${hostCss}</style>`;
  document.documentElement.dataset["theme"] = theme;
  const probe = document.createElement("div");
  probe.innerHTML = `<svg><rect fill="var(--kg-color-canvas, ${DRAWN_CANVAS})"/><path fill="var(--kg-color-accent, ${DRAWN_ACCENT})"/></svg>`;
  document.body.append(probe);
  const style = getComputedStyle(document.documentElement);
  // jsdom hands back a custom property's *declared* value, `var(--pg-bg-raised)` and all, so the
  // reference chain is walked here. Which is the mechanism under test stated out loud: a figure's
  // paint is a reference into the page's tokens, and what it ends at is whatever the page says.
  const resolve = (name: string): string => {
    let value = style.getPropertyValue(name).trim();
    for (let hop = 0; hop < 4; hop++) {
      const ref = /^var\(\s*(--[a-z0-9-]+)/i.exec(value);
      if (ref === null) return value;
      value = style.getPropertyValue(ref[1]!).trim();
    }
    return value;
  };
  return { canvas: resolve("--kg-color-canvas"), accent: resolve("--kg-color-accent") };
}

describe("a figure and the page it sits in", () => {
  it("resolves its paints from the page's tokens, not from a palette pinned at :root", () => {
    // The bridge is the whole mechanism, and it is in the tokens layer where a host can beat it.
    const bridge = read("../client/tokens.css");
    expect(bridge).toContain("--kg-color-canvas: var(--pg-");
    expect(bridge).toContain("--kg-color-accent: var(--pg-");
    // The article declares a theme, and the page still publishes no palette of its own. That is
    // the inversion: the declaration draws the figure, the page paints it.
    const html = renderPageHtml(article, "/", ctx);
    expect(html).not.toContain("--kg-color-");
    expect(paint(html, "light")).toEqual({ canvas: "#f6f7f9", accent: "#3b5bdb" });
  });

  it("follows the reader's theme, because the page's tokens are what moved", () => {
    const html = renderPageHtml(article, "/", ctx);
    expect(paint(html, "dark")).toEqual({ canvas: "#1c1f26", accent: "#7c9bff" });
  });

  it("follows a host that mapped only --pg-*, which is what used to be impossible", () => {
    // The reported failure: a dark host, an article with a light Kineglyph theme, and a figure that
    // stayed light because the declared palette outranked everything the host had said.
    const html = renderPageHtml(article, "/", ctx);
    expect(paint(html, "light", ":root{--pg-bg-raised:#101216;--pg-accent:#67cbbb}"))
      .toEqual({ canvas: "#101216", accent: "#67cbbb" });
  });

  it("still lets a host address the diagrams alone", () => {
    // Finer control over figures than over prose stays available: `--kg-color-*` set directly is
    // level 2 speaking about diagrams, and nothing pagina emits contests it any more.
    const html = renderPageHtml(article, "/", ctx);
    expect(paint(html, "light", ":root{--kg-color-accent:#ff00ff}").accent).toBe("#ff00ff");
  });

  it("loads the article's theme module for the figures it draws, and nothing else", () => {
    // The module still reaches the runtime — it is what a live figure is drawn with, and it is the
    // source of the literals in the served SVG. What it no longer does is write page variables.
    const html = renderPageHtml(article, "/", { ...ctx, kineglyphThemeUrl: "/theme/kineglyph.mjs" });
    expect(html).toContain(`data-kg-theme="/theme/kineglyph.mjs"`);
    expect(html).not.toContain("--kg-color-");
  });
});
