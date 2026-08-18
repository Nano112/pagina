/**
 * The theming showcase: one article, six identities, and the cost of each in lines.
 *
 * ## Why each identity gets a frame of its own
 *
 * Custom properties inherit, so scoping a token map to a `<div>` would have re-tinted a sample in
 * place with a tenth of this code. It would also have been a demonstration of something pagina does
 * not offer. Two of the six identities are not token maps at all: **Broadsheet** overrides ordinary
 * rules and is only interesting if you can see that its selectors beat pagina's *from outside a
 * layer*, and **Bare column** links `pagina.tokens.css` instead of `pagina.css`, which is a
 * different stylesheet and cannot be emulated by scoping anything.
 *
 * So each identity is a real document, in a same-origin `srcdoc` frame, linking a real pagina
 * artefact and wearing exactly the CSS printed beneath it. The listing is not a description of the
 * frame; it is the frame's stylesheet, handed to both.
 *
 * The frames carry `sandbox="allow-same-origin"` — same-origin so their height can be measured,
 * and nothing else, because none of them runs a line of script.
 *
 * ## Why the sample is written here
 *
 * A frame has no renderer in it. The sample is therefore hand-written HTML in pagina's own class
 * names rather than markdown, and `test/theming-lab.test.ts` renders the equivalent markdown
 * through `@pagina/core` and checks that the two use the same classes — so markup that drifts
 * fails a test instead of quietly showing a reader a shape pagina no longer emits.
 *
 * The figure is the exception, and the best part: a real pre-rendered Kineglyph figure is cloned
 * off the host page into every frame, so six identities re-tint one drawing between them, with no
 * re-render and no second copy of anything.
 */
import { IDENTITIES, identityCss, lineCount, tokenBlock, type Identity } from "./identities.js";

export interface ThemeShowcaseOptions {
  /** Absolute URL of `pagina.css`. Required: a frame has no base to resolve a relative one from. */
  readonly paginaCssUrl: string;
  /** Absolute URL of `pagina.tokens.css`, for the `theme: "tokens"` identity. */
  readonly tokensCssUrl?: string;
  /** Replaces the built-in sample. */
  readonly sampleHtml?: string;
  /**
   * A `figure.kg` to clone into every frame. Omitted, the showcase takes the first one on the
   * page; pass `null` for none.
   */
  readonly figureHtml?: string | null;
}

export interface ThemeShowcaseHandle {
  /** The identities rendered, in order. */
  readonly identities: readonly Identity[];
  /** The exact CSS a frame is wearing, by identity id. */
  cssFor(id: string): string;
  destroy(): void;
}

/* --------------------------------------------------------------------------------------------
 * The sample.
 * ------------------------------------------------------------------------------------------ */

/** A stand-in glyph. The class is pagina's, so the hue and the size are the identity's. */
const glyph = (paths: string): string =>
  `<svg class="pg-admonition__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

/** Where {@link clonedFigure}'s output goes in the sample. */
const FIGURE_SLOT = "<!--figure-->";

const NOTE_GLYPH = glyph('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>');
const WARNING_GLYPH = glyph('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>');

/**
 * One page of an article, holding one of everything the reading layer has an opinion about.
 *
 * It is short on purpose: six frames of it are on the page at once, and the differences between
 * identities are legible in a paragraph, a heading, a callout and a table. Anything longer would
 * make the reader scroll a frame instead of comparing frames.
 */
const SAMPLE = `<h1>Reading the tide tables</h1>
<p>A tide table is a promise about water, written a year in advance. It is also a good test of a
stylesheet: it needs a <a href="#">link</a>, a piece of <code>inline code</code>, a heading with
something under it, and a table nobody enjoys reading.</p>
<h2>Taking a reading</h2>
<p>Stand at the gauge until the water is still, then read the mark the meniscus sits on rather than
the one above it.</p>
<aside class="pg-admonition pg-admonition--note"><p class="pg-admonition__title">${NOTE_GLYPH}<span class="pg-admonition__label">Datum</span></p>
<p>Heights are above chart datum, not above sea level. The two differ by a metre in places.</p>
</aside>
<!--figure-->
<ul>
<li>Read at the top of the minute.</li>
<li>Record what the gauge said, not what you expected.</li>
</ul>
<pre><code>tide --station cromer --span 24h
  high  04:12  4.7m
  low   10:38  0.9m</code></pre>
<table>
<thead><tr><th>Station</th><th>High</th><th>Range</th></tr></thead>
<tbody>
<tr><td>Cromer</td><td>04:12</td><td>3.8 m</td></tr>
<tr><td>Wells</td><td>04:44</td><td>4.1 m</td></tr>
</tbody>
</table>
<aside class="pg-admonition pg-admonition--warning"><p class="pg-admonition__title">${WARNING_GLYPH}<span class="pg-admonition__label">Spring tides</span></p>
<p>A predicted low is not a guaranteed low. Wind holds water in.</p>
</aside>
<blockquote><p>The sea does not read the table either.</p></blockquote>`;

/**
 * The page's own figure, prepared for a frame.
 *
 * Three things are taken off the clone, and each one is a defect if it is left on.
 *
 * **The extra variants.** A published figure carries one drawing per width in
 * `article.yaml`'s `kineglyph.widths`, and exactly one is shown — chosen by `@container` rules that
 * `@pagina/core` *generates for the page* and inlines beside the figures, because the widths are the
 * article's and a stylesheet naming them would disagree with any article that chose its own. A frame
 * does not have that inline `<style>`, so all four drawings show at once and a 900 px card becomes a
 * 4 000 px one. Keeping only the widest and dropping `data-kg-variants` puts the frame on the
 * single-drawing path that `reading.css` handles unaided, which is also the shortest of the four.
 *
 * **The live stage and the scene.** A frame runs no script — `sandbox="allow-same-origin"` and
 * nothing else — so an empty `[data-kg-stage]` would reserve height for a drawing that is never
 * going to arrive.
 *
 * **The caption**, which belongs to the page's argument and not to the sample's.
 */
function clonedFigure(doc: Document): string {
  const original = doc.querySelector("figure.kg");
  if (original === null) return "";
  const clone = original.cloneNode(true) as HTMLElement;
  clone.removeAttribute("id");
  clone.removeAttribute("data-scene");
  clone.removeAttribute("data-kg-variants");
  const variants = clone.querySelectorAll("svg[data-kg-variant]");
  for (let i = 1; i < variants.length; i++) variants[i]?.remove();
  for (const stage of clone.querySelectorAll("[data-kg-stage]")) stage.remove();
  const caption = clone.querySelector("figcaption");
  if (caption !== null) caption.textContent = "One drawing, six palettes. Nothing here defines a --kg-* — the figure follows the page because the page's tokens are what it is painted from.";
  return clone.outerHTML;
}

/* --------------------------------------------------------------------------------------------
 * The showcase's own chrome. Token-driven, like everything else here.
 * ------------------------------------------------------------------------------------------ */

/**
 * How tall a frame may get before it scrolls inside itself.
 *
 * A frame sized purely to its content runs to about 1 400 px, and six of those is a section a
 * reader scrolls past rather than reads. Capped, all six are the same height and therefore the same
 * crop — which is what makes them comparable at all — and the cap is chosen so that the sample's
 * heading, lead, callout and most of the diagram are above it. The rest is a scroll away inside the
 * frame, and the listing under it says what changed regardless.
 *
 * Kept in step with `.pgs__iframe`'s `block-size` below, which is what a frame wears until it has
 * been measured.
 */
const MAX_FRAME_PX = 736;

const SHOWCASE_CSS = `
.pgs { display: grid; gap: 2rem; margin-block: 1.5rem; }
.pgs__card { display: grid; gap: 0.6rem; }
.pgs__head { display: grid; gap: 0.2rem; }
.pgs__name { margin: 0; font-family: var(--pg-font-display); font-size: 1.1rem; font-weight: 700; }
.pgs__rung {
  margin-inline-start: 0.5rem; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--pg-muted); white-space: nowrap;
}
.pgs__blurb { margin: 0; color: var(--pg-muted); font-size: 0.9rem; }
.pgs__frame {
  border: 1px solid var(--pg-line-strong); border-radius: var(--pg-radius-lg);
  overflow: hidden; background: var(--pg-bg-raised); min-block-size: 12rem;
}
.pgs__iframe { display: block; inline-size: 100%; block-size: 46rem; border: 0; }
.pgs__cost { margin: 0; font-size: 0.9rem; }
.pgs__cost strong { font-variant-numeric: tabular-nums; }
.pgs__cost code {
  font-family: var(--pg-font-mono); font-size: 0.88em;
  background: var(--pg-code-bg); padding: 0.1em 0.3em; border-radius: var(--pg-radius);
}
.pgs__css > summary {
  cursor: pointer; font-size: 0.85rem; color: var(--pg-accent);
  padding: 0.2rem 0; border-radius: var(--pg-radius);
}
.pgs__css > summary:focus-visible, .pgs__copy:focus-visible { outline: 2px solid var(--pg-accent); outline-offset: 2px; }
.pgs__code {
  margin: 0.4rem 0; max-block-size: 22rem; overflow: auto; padding: 0.75rem;
  border: 1px solid var(--pg-line); border-radius: var(--pg-radius);
  background: var(--pg-bg-sunken); color: var(--pg-fg);
  font-family: var(--pg-font-mono); font-size: 0.78rem; line-height: 1.5; white-space: pre;
}
.pgs__copy {
  font: inherit; font-size: 0.82rem; cursor: pointer; padding: 0.25rem 0.6rem;
  border: 1px solid var(--pg-line-strong); border-radius: var(--pg-radius);
  background: var(--pg-bg); color: var(--pg-fg);
}
.pgs__status { margin-inline-start: 0.5rem; color: var(--pg-muted); font-size: 0.8rem; }
@media (max-width: 30rem) {
  .pgs { gap: 1.5rem; }
}
`;

function injectStyles(doc: Document): void {
  if (doc.querySelector("style[data-pagina-theme-showcase-css]") !== null) return;
  const style = doc.createElement("style");
  style.setAttribute("data-pagina-theme-showcase-css", "");
  style.textContent = SHOWCASE_CSS;
  doc.head.appendChild(style);
}

/* --------------------------------------------------------------------------------------------
 * Building one frame.
 * ------------------------------------------------------------------------------------------ */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

/**
 * The frame's document.
 *
 * `.pg-content` and the padding around it are all the showcase adds. Everything else the reader
 * sees is the linked artefact plus the identity's own CSS, which is the claim being made.
 */
function frameHtml(identity: Identity, sample: string, cssUrl: string): string {
  const css = identityCss(identity);
  return `<!doctype html>
<html lang="en" data-theme="${identity.scheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${esc(cssUrl)}">
${css === "" ? "" : `<style>\n${css}\n</style>`}
<style>
  body { margin: 0; background: var(--pg-bg); color: var(--pg-fg); font-family: var(--pg-font); }
  .pgs-page { padding: 1.25rem 1.4rem 2rem; }
</style>
</head>
<body><main class="pgs-page"><article class="pg-content">${sample}</article></main></body>
</html>`;
}

/** What the reader is being asked to accept, counted from the string the frame is wearing. */
function costLine(identity: Identity): string {
  if (identity.rung === 0) return "Nothing at all.";
  const tokens = lineCount(tokenBlock(":root", identity.tokens));
  const rules = lineCount(identity.rules ?? "");
  // The total is counted off the file rather than added up, so it agrees with the listing's own
  // count — which includes the blank line between the two halves, as any real file would.
  const all = lineCount(identityCss(identity));
  if (rules === 0) return `${String(tokens)} lines of token mapping.`;
  const second = identity.themeLevel === "tokens" ? "content column" : "ordinary CSS";
  return `${String(tokens)} lines of tokens and ${String(rules)} lines of ${second} — ${String(all)} in all.`;
}

/**
 * A note, with `backticks` turned into `<code>`.
 *
 * The notes name selectors and at-rules, and printing them as literal backticks in a paragraph is
 * the kind of small wrongness that makes a reader trust the numbers above them less.
 */
function noteHtml(doc: Document, note: string): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const parts = note.split("`");
  for (const [index, part] of parts.entries()) {
    if (part === "") continue;
    if (index % 2 === 0) fragment.append(doc.createTextNode(part));
    else {
      const code = doc.createElement("code");
      code.textContent = part;
      fragment.append(code);
    }
  }
  return fragment;
}

const RUNGS: Record<number, string> = {
  0: "Rung 0 · unchanged",
  1: "Rung 1 · map the tokens",
  2: "Rung 2 · override rules",
  3: 'Rung 3 · theme: "tokens"',
};

/* --------------------------------------------------------------------------------------------
 * Mount.
 * ------------------------------------------------------------------------------------------ */

export function mountThemeShowcase(host: HTMLElement, options: ThemeShowcaseOptions): ThemeShowcaseHandle {
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  injectStyles(doc);
  host.classList.add("pgs");
  host.replaceChildren();

  const figure = options.figureHtml === null ? "" : (options.figureHtml ?? clonedFigure(doc));
  // The figure sits in the middle of the sample rather than under it: a diagram at the bottom of a
  // 900 px frame is a diagram nobody compares.
  const body = options.sampleHtml ?? SAMPLE;
  const sample = body.includes(FIGURE_SLOT) ? body.replace(FIGURE_SLOT, figure) : body + figure;

  const applied = new Map<string, string>();
  const cleanups: (() => void)[] = [];

  for (const identity of IDENTITIES) {
    const cssUrl =
      identity.themeLevel === "tokens" && options.tokensCssUrl !== undefined
        ? options.tokensCssUrl
        : options.paginaCssUrl;
    const css = identityCss(identity);
    applied.set(identity.id, css);

    const card = doc.createElement("article");
    card.className = "pgs__card";
    card.id = `identity-${identity.id}`;

    const head = doc.createElement("div");
    head.className = "pgs__head";
    const name = doc.createElement("h3");
    name.className = "pgs__name";
    name.append(doc.createTextNode(identity.name));
    const rung = doc.createElement("span");
    rung.className = "pgs__rung";
    rung.textContent = RUNGS[identity.rung] ?? "";
    name.append(rung);
    const blurb = doc.createElement("p");
    blurb.className = "pgs__blurb";
    blurb.textContent = identity.blurb;
    head.append(name, blurb);
    card.append(head);

    const frame = doc.createElement("div");
    frame.className = "pgs__frame";
    const iframe = doc.createElement("iframe");
    iframe.className = "pgs__iframe";
    iframe.title = `${identity.name} — the same article under this theme`;
    iframe.setAttribute("sandbox", "allow-same-origin");
    iframe.dataset["identity"] = identity.id;
    frame.append(iframe);
    card.append(frame);

    const cost = doc.createElement("p");
    cost.className = "pgs__cost";
    const costStrong = doc.createElement("strong");
    costStrong.textContent = costLine(identity);
    cost.append(costStrong, doc.createTextNode(" "), noteHtml(doc, identity.note));
    card.append(cost);

    if (css !== "") card.append(listing(doc, identity, css, view));
    host.append(card);

    // Written when the frame is near the viewport: six documents, each linking a stylesheet, is
    // not something a reader who never scrolls to this section should pay for.
    const write = (): void => {
      if (iframe.srcdoc !== "") return;
      iframe.srcdoc = frameHtml(identity, sample, cssUrl);
    };
    iframe.addEventListener("load", () => {
      fit(iframe);
    });
    if (view !== null && "IntersectionObserver" in view) {
      const watcher = new view.IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          watcher.disconnect();
          write();
        },
        { rootMargin: "300px" },
      );
      watcher.observe(iframe);
      cleanups.push(() => {
        watcher.disconnect();
      });
    } else {
      write();
    }

    // A frame's height depends on its width, and its width depends on the reader's window.
    if (view !== null && "ResizeObserver" in view) {
      const resize = new view.ResizeObserver(() => {
        fit(iframe);
      });
      resize.observe(frame);
      cleanups.push(() => {
        resize.disconnect();
      });
    }
  }

  return {
    identities: IDENTITIES,
    cssFor: (id: string) => applied.get(id) ?? "",
    destroy: () => {
      for (const off of cleanups) off();
      host.replaceChildren();
      host.classList.remove("pgs");
    },
  };
}

/**
 * Size the frame to its content.
 *
 * A `srcdoc` frame has no intrinsic height, and a fixed one either clips an identity with a taller
 * rhythm or leaves a hole under a denser one — which would make the frames incomparable, since
 * rhythm is one of the things on show. Same-origin is what makes this measurable, and is the only
 * reason the sandbox allows it.
 */
function fit(iframe: HTMLIFrameElement): void {
  try {
    const inner = iframe.contentDocument;
    if (inner === null) return;
    const height = Math.min(inner.documentElement.scrollHeight, MAX_FRAME_PX);
    if (height > 0) iframe.style.blockSize = `${String(height)}px`;
  } catch {
    /* a frame we cannot measure keeps the stylesheet's height */
  }
}

/** The listing under a frame: the very string the frame is wearing, and a way to take it. */
function listing(doc: Document, identity: Identity, css: string, view: Window | null): HTMLElement {
  const details = doc.createElement("details");
  details.className = "pgs__css";
  const summary = doc.createElement("summary");
  summary.textContent = `Show the ${String(lineCount(css))} lines`;
  details.append(summary);
  const pre = doc.createElement("pre");
  pre.className = "pgs__code";
  pre.tabIndex = 0;
  pre.setAttribute("aria-label", `The CSS behind ${identity.name}`);
  pre.textContent = css;
  details.append(pre);
  const row = doc.createElement("p");
  const copy = doc.createElement("button");
  copy.type = "button";
  copy.className = "pgs__copy";
  copy.textContent = "Copy";
  const status = doc.createElement("span");
  status.className = "pgs__status";
  status.setAttribute("role", "status");
  copy.addEventListener("click", () => {
    const clipboard = view?.navigator.clipboard;
    if (clipboard === undefined) {
      status.textContent = "Select the block above and copy it.";
      return;
    }
    void clipboard.writeText(css).then(
      () => (status.textContent = "Copied."),
      () => (status.textContent = "Copying was blocked."),
    );
  });
  row.append(copy, status);
  details.append(row);
  return details;
}
