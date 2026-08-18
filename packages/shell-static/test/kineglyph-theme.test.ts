/**
 * @vitest-environment jsdom
 *
 * A figure must be painted in the colours it was drawn in.
 *
 * Kineglyph draws every fill as `var(--kg-color-<role>, <literal>)`: the literal is the theme the
 * figure was rendered with, the variable is what a page may override it with. `pagina.css` takes
 * that up and points every `--kg-color-*` at the matching `--pg-*`, which is how a host retints
 * diagrams it did not draw — and which also meant that an article shipping its own theme module got
 * it applied to the drawing and then overruled at paint. The served SVG said `#237f74`; the reader
 * saw pagina's `#3b5bdb`, a colour that appears nowhere in the article.
 *
 * So the check is not "the shell emits an attribute". It is the thing a reader can see: the colour
 * the browser resolves for the **pre-rendered** frame and for the **hydrated** stage, against a
 * page that also carries pagina's default bridge. Both are the same SVG markup, so one measurement
 * covers both — what differs between them is only which element is on screen.
 */
import { describe, expect, it } from "vitest";
import { renderPageHtml, type ShellCtx } from "../src/template.js";
import { read } from "./css-layers.js";
import type { KineglyphThemeColors, RenderedArticle } from "@pagina/core";

const article: RenderedArticle = {
  diagnostics: [],
  manifest: {
    article: { slug: "t", title: "T", form: "docs", status: "published", visibility: "public", tags: [], rootHref: "/", coverOn: "root" },
    nav: [{ title: "Home", href: "/" }],
    pages: { "/": { title: "Home", headings: [], breadcrumbs: [{ title: "Home", href: "/" }] } },
    figures: {}, assets: [],
  },
  pages: { "/": { path: "index.md", href: "/", title: "Home", html: "<p>hi</p>", headings: [], figures: [], links: [], frontMatter: {} } },
};

const ctx: ShellCtx = { base: "/", dev: false, clientUrl: "/_pagina/pagina.js", cssUrl: "/_pagina/pagina.css", kineglyphRuntimeUrl: "/_pagina/kineglyph.js" };

/** Nucleation's palette, which is the one the defect was found in. */
const ACCENT = "#237f74";
const CANVAS = "#f4f1e9";
const DARK_CANVAS = "#101216";

const themed: KineglyphThemeColors = {
  light: { colors: { canvas: CANVAS, accent: ACCENT, surfaceRaised: "#fffdf8" } },
  dark: { colors: { canvas: DARK_CANVAS, accent: "#67cbbb", surfaceRaised: "#1b1f25" } },
};

/**
 * Builds the page in jsdom with pagina's real stylesheet, and reports the colour the browser
 * resolves for a figure's canvas — the same `var(--kg-color-canvas, …)` the pre-rendered frame and
 * the live stage both carry.
 */
function paint(html: string, theme: "light" | "dark"): { canvas: string; accent: string } {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
  // The `<link>` is not fetched by jsdom, so the sheet it names is inlined in its place — with the
  // page's own `<style>` kept in its original position, because the whole question is source order.
  document.head.innerHTML = head.replace(
    /<link rel="stylesheet"[^>]*>/,
    `<style>${read("../client/pagina.css").replace(/^@import[^;]*;$/gm, "")}</style><style>${read("../client/tokens.css").replace(/^@import[^;]*;$/gm, "")}</style>`,
  );
  document.documentElement.dataset["theme"] = theme;
  const probe = document.createElement("div");
  probe.innerHTML = `<svg><rect class="kg-canvas" fill="var(--kg-color-canvas, ${CANVAS})"/><path class="kg-accent" fill="var(--kg-color-accent, ${ACCENT})"/></svg>`;
  document.body.append(probe);
  const style = getComputedStyle(document.documentElement);
  return { canvas: style.getPropertyValue("--kg-color-canvas").trim(), accent: style.getPropertyValue("--kg-color-accent").trim() };
}

describe("an article's declared kineglyph theme", () => {
  it("reaches the page as the variables its figures are painted from", () => {
    const html = renderPageHtml(article, "/", { ...ctx, kineglyphTheme: themed });
    expect(paint(html, "light")).toEqual({ canvas: CANVAS, accent: ACCENT });
  });

  it("beats pagina's --pg-* bridge, which is what used to repaint the figure", () => {
    // The bridge is still there, and still the answer for an article that declared no theme.
    const bridge = read("../client/tokens.css");
    expect(bridge).toContain("--kg-color-canvas: var(--pg-");
    expect(bridge).toContain("--kg-color-accent: var(--pg-");
    // Two `:root` rules of equal specificity: the later one wins, so the declared theme has to be
    // emitted *after* the stylesheet. Both halves are asserted, because either alone would pass a
    // page that never linked the sheet at all.
    const html = renderPageHtml(article, "/", { ...ctx, kineglyphTheme: themed });
    const sheet = html.indexOf('<link rel="stylesheet"');
    const declared = html.indexOf("--kg-color-canvas");
    expect(sheet).toBeGreaterThan(-1);
    expect(declared).toBeGreaterThan(sheet);
  });

  it("switches with the page's theme, so the frame and the stage move together", () => {
    const html = renderPageHtml(article, "/", { ...ctx, kineglyphTheme: themed });
    expect(paint(html, "dark").canvas).toBe(DARK_CANVAS);
  });

  it("emits nothing at all for an article that declares no theme", () => {
    expect(renderPageHtml(article, "/", ctx)).not.toContain("--kg-color-");
  });

  it("stays out of a page that asked for no pagina CSS", () => {
    expect(renderPageHtml(article, "/", { ...ctx, kineglyphTheme: themed, theme: "none" })).not.toContain("--kg-color-");
  });

  it("drops a colour that is not one, rather than closing the style element with it", () => {
    const nasty: KineglyphThemeColors = { light: { colors: { canvas: '</style><script>alert(1)</script>' } }, dark: { colors: {} } };
    const html = renderPageHtml(article, "/", { ...ctx, kineglyphTheme: nasty });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("--kg-color-canvas");
  });
});
