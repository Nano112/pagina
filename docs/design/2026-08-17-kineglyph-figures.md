# Kineglyph figures that belong to the page — design

Date: 2026-08-17. Status: approved by the user's brief ("get some kineglyphs involved too, properly
integrated and nice looking"). Evidence: `.superpowers/sdd/2026-08-17-theming/kineglyph-audit.md`.

## What is actually wrong

The authoring half is good and stays: `sceneFromSpec` covers 5 node kinds, recursive boxes, edges with
heads and styles, 11 semantic tones; the Figure Builder exposes nearly all of it with a live preview
that holds the last good frame while a spec is mid-edit. Leave it alone.

The delivery half does not survive contact with a host:

1. **A figure cannot be themed.** The palette is baked into the SVG as literal hex presentation
   attributes, `--kg-*` is pinned by an inline `style` on the root `<svg>`, and the whole thing arrives
   through `<img>` — which is a document boundary, so no host CSS reaches it even in principle. A
   figure authored in pagina's blue-violet stays blue-violet inside schemat.io's magenta.
2. **Every figure is invisible to assistive tech.** The SVG carries `role="img"` and a `<title>`, and
   then `figures.ts:39` emits `alt=""` on the `<img>`, which overrides all of it and discards the
   author's description.
3. **The path has never run.** Every stored figure SVG in schemati is a 21-byte Pest stub;
   `storage/app/articles` does not exist. The plumbing is complete and unexercised.
4. **Unreadable on a phone.** One prerender width (960) and geometric scaling put 16px type at ~6px.
5. No `<figcaption>` convention; a layout shift on hydration; three CSS rules in total.

## The fact that makes this tractable

**Publishing already happens in the host's browser.** The editor runs inside schemat.io, renders the
article with core and the figures with Kineglyph's `renderSvg`, and POSTs the result. So at the moment
a figure's geometry is measured, the host's real font — Figtree — is loaded and measurable.

That splits cleanly along the axis that matters:

| Concern | When it is decided | Why |
|---|---|---|
| **Geometry** — box sizes, text metrics, layout | **Publish time**, in the host's browser | SVG cannot wrap or reflow text; boxes must be measured against the font that will render them |
| **Colour** — every fill, stroke, ink | **View time**, by CSS | The reader's theme is not knowable at publish time, and a host may retheme after publishing |

Baking colour is what breaks theming. Baking geometry is correct and stays.

## Decisions

**Colour becomes tokens.** Every colour in an emitted SVG is `var(--kg-<role>, <the current hex>)`.
The fallback is exactly today's value, so an unstyled figure is byte-for-byte as it looks now and
nothing regresses. `tokens.css` maps `--pg-*` onto `--kg-*` so a host that already mapped pagina's
tokens gets themed figures for free, and the `--kg-*` set joins the published contract in
`docs/theming.md` for hosts that want finer control.

**Delivery becomes inline SVG.** `<img>` is the reason no CSS reaches a figure; inlining removes the
boundary. It is still server-rendered, so no-JS keeps working — this trades a cacheable subresource for
themability and accessibility, which is the right trade for diagrams that are part of the prose.

**Measurement uses the resolved font.** The prerenderer reads the actual computed font from the
document rather than assuming Inter. A host publishing in Figtree gets geometry measured in Figtree.

**Accessibility stops being an afterthought.** A figure is a `<figure>` with an optional
`<figcaption>`; the SVG keeps `role="img"` with `<title>` and `<desc>` carrying the author's text; the
`alt=""` bug dies with the `<img>` it sits on. An author who gives no description gets a build
diagnostic, not a silently inaccessible diagram.

**Responsive by scrolling, not shrinking.** A diagram that shrinks to 6px type is not responsive, it is
broken. Below its natural width a figure scrolls inside its own container with a `min-width` that keeps
type legible — the same treatment wide tables and code blocks already get, so it reads as one rule.

**No layout shift.** The live stage reserves the prerendered figure's aspect ratio before hydration.

**A figure in prose is a picture** *(added 2026-08-17, task K2)*. The first pass shipped the
runtime's default chrome on every published figure: an INSPECT readout and a Play/Restart/TIMELINE
strip, whether or not there was anything behind either. On a still three-box diagram in an article
that is a debug harness wrapped around a picture, and it was the whole of the ~100px the figure grew
on hydration. The default is now quiet and the instrument is opted into per figure with
`data-instrument="true"`.

The rule has two halves and both must hold:

| Half | Who owns it | What it asks |
|---|---|---|
| the editorial one | pagina (`client/figure-chrome.ts`) | did the author ask for an instrument? |
| the honest one | Kineglyph (`ChromeSetting`'s `"auto"`) | does the scene have anything behind it? |

So Kineglyph gains a knob rather than an opinion: `controls`/`readout`/`machineControls` become
`boolean | "auto"`, `"auto"` meaning "draw it only if the resolved scene justifies it" — a timeline
with a duration, a node that is inspectable, a declared machine. Its own default stays `true`.
pagina supplies the opinion, because "a figure between two paragraphs is a picture" is a statement
about articles, not about figures.

**Hydration is measured, not asserted** *(K2)*. Once the chrome matched, three defaults were still
moving the figure, and all three were chrome-era furniture: the shell's border, the stage's 120px
minimum height, and — the largest — the runtime re-resolving the scene at the column width, so the
diagram silently rearranged itself and got taller the moment JavaScript landed. A quiet figure is
therefore mounted at the width its geometry was decided at, which makes the live drawing the same
drawing and extends "scroll, don't shrink" to readers who have JavaScript (before this, a phone
with JavaScript on got the 0.41-scale 6px type the pre-rendered frame exists to avoid). The
before/after heights are compared in the `bundle` Playwright project across two loads of one URL,
with a one-pixel tolerance.

## Out of scope

A first-class `figure_kg` markdown block (figures are raw `<figure class="kg">` HTML matched by regex
today; it works, and `md_in_html` is the dialect's own spirit). Chart scenes, motifs and edge routing
stay hand-written `defineScene` territory — the builder covers the simple-scene case it was built for.

## Verification

The bar is the one this project keeps learning: **built assets, foreign host, real browser.** A figure
authored in the builder, published through schemati for the first time ever, rendering in schemat.io's
magenta-on-near-black with Figtree geometry, legible on a phone, and reachable by a screen reader.
