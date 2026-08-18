/**
 * pagina's editorial default for a Kineglyph figure: **a figure in an article is a picture.**
 *
 * Kineglyph's own default is the opposite, and correctly so — its runtime is a general-purpose
 * figure host, and a figure mounted in a playground or a lab wants its instrument. But a diagram
 * sitting between two paragraphs of prose is not an instrument. Defaulting the chrome on gave a
 * still three-box "how publishing works" diagram an INSPECT readout it could never fill and a
 * Play/Restart/TIMELINE strip driving a 0.0s track: roughly double the height, a debug harness
 * wrapped around a picture, and the direct cause of the ~100px the figure used to grow on
 * hydration.
 *
 * So pagina asks for quiet and lets the author opt in. That decision belongs here rather than in
 * Kineglyph: the library supplies the knob (`ChromeSetting`'s `"auto"`), pagina supplies the
 * opinion about what a figure in prose should look like when nobody said.
 *
 * ### The rule
 *
 * | The figure says | It gets |
 * |---|---|
 * | nothing | no readout, no transport — the picture, its frame and its caption |
 * | `data-instrument="true"` | whatever the scene justifies: `"auto"` for both |
 * | `data-controls`/`data-readout` explicitly | exactly that, untouched |
 *
 * Two things compose here, and both have to hold for chrome to appear: the **author** has to ask
 * for the instrument, and the **scene** has to have something behind it. Asking is not enough —
 * `data-instrument="true"` on a still diagram still shows no transport, because a disabled Play
 * button against a 0.0s track is furniture, not a control. That is `"auto"`'s half of the rule and
 * it lives in Kineglyph.
 *
 * The explicit escape hatch is what keeps every already-authored figure working: a figure that
 * wrote `data-controls="false"` keeps its silence, and one that wrote `data-controls="true"` keeps
 * its transport even where `"auto"` would have declined. Only figures that said *nothing* change,
 * which is the whole set this is meant to change.
 *
 * ### And the figure that should not hydrate at all
 *
 * Quiet is not the end of it. Once a figure has no chrome, ask what the mount is still for. For a
 * still diagram — no timeline, nothing inspectable, no machine, no live surface — the answer is
 * nothing: the runtime resolves the same scene at the same width and draws the same picture over
 * the top of the pre-rendered SVG that was already on screen. It is not a no-op, it is a loss. The
 * server-rendered frame is the accessible one, it is painted before any script runs, and replacing
 * it costs a module fetch, a resolve and a DOM rebuild to arrive back where it started.
 *
 * So pagina declines those. `inlineFigureSvgs` marks them `data-kg-inert="true"` at publish time,
 * from Kineglyph's own `sceneNeedsRuntime`, and `figureChrome` returns `null` — which `mountAll`
 * reads as "skip this element", *before* it fetches the scene.
 *
 * What that gives up, deliberately, is small and each piece was checked:
 *
 * - **Theme reactivity.** Colour is `var(--kg-color-*)` in the emitted SVG and mapped from `--pg-*`
 *   in `tokens.css`, so a theme flip retints the frame through CSS with no JavaScript at all. What
 *   a live mount adds over that is repainting colours a scene *derived* (`mixColor`), which have no
 *   role to name them by, and honouring a runtime theme's font or radii — both of which would
 *   change the figure's geometry, so an inert figure is better off not following them.
 * - **Resizing.** A quiet figure is mounted at a fixed `--kg-w` and the runtime attaches no
 *   `ResizeObserver` when a width is given, so there was nothing to lose.
 * - **Lazy mounting.** Not mounting is strictly cheaper than mounting late.
 *
 * A figure with no `data-kg-inert` mark is mounted exactly as before, so a figure that has never
 * been pre-rendered — dev before a build, a failed prerender, a host that inlines nothing — still
 * hydrates. The mark is only ever added when there is a frame to keep.
 */

/** The subset of Kineglyph's `MountOptions` this decides. Structural, so no runtime import. */
export interface FigureChrome {
  readonly controls?: boolean | "auto";
  readonly readout?: boolean | "auto";
  readonly machineControls?: boolean | "auto";
  readonly width?: number;
}

/**
 * The width a figure's geometry was decided at, from the `--kg-w` stamped on it at publish time.
 * `undefined` for a figure that has not been pre-rendered — in dev, or before a build has run.
 */
function naturalWidth(element: HTMLElement): number | undefined {
  const raw = Number.parseFloat(element.style.getPropertyValue("--kg-w"));
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/**
 * Whether this figure already shows something without JavaScript. The same selector `mountAll`
 * uses to find the frame it hides, because declining to mount is only safe when there is a frame
 * that would have been hidden.
 */
function hasStaticFrame(element: HTMLElement): boolean {
  return element.querySelector(":scope > img, :scope > picture, :scope > [data-kg-static]") !== null;
}

/**
 * The chrome options for one `<figure class="kg">`.
 *
 * Returned as a *partial*: a key that is absent is a key pagina declines to have an opinion about,
 * and Kineglyph's own `data-controls`/`data-readout` parsing stands. That is deliberate — this is
 * spread last over the runtime's dataset-derived options, so returning a value here would
 * overwrite what the author explicitly wrote.
 */
export function figureChrome(element: HTMLElement): FigureChrome | null {
  // `data-instrument` is the author's word for "this figure is worth poking at". Anything other
  // than "true" (including the attribute being absent) leaves the figure quiet.
  const wanted = element.dataset.instrument === "true" ? "auto" : false;
  /*
   * Declined: the scene has nothing the runtime could drive (`data-kg-inert`, stamped at publish
   * time) and there is a pre-rendered frame to keep. Both halves matter — the mark alone is not
   * enough, because a figure with no frame has nothing to show if we do not mount.
   *
   * An author who asked for the instrument gets it even here: `data-instrument="true"` is a
   * request to be able to poke at the thing, and the runtime's own `"auto"` will still decline any
   * chrome the scene does not justify.
   */
  if (wanted === false && element.dataset.kgInert === "true" && hasStaticFrame(element)) return null;
  const chrome: {
    controls?: boolean | "auto";
    readout?: boolean | "auto";
    machineControls?: boolean | "auto";
    width?: number;
  } = {
    /*
     * Always deferred, never forced. The machine bar is content-gated in the runtime anyway (it
     * hides itself when the scene declares no controls), so `"auto"` changes nothing a reader can
     * see — it only stops an empty `<div>` being created for a scene with no machine. That matters
     * because the stylesheet asks `:has(… .kg-figure__machine)` whether this figure has chrome, and
     * an always-present empty bar would answer yes for every figure on the site.
     */
    machineControls: "auto",
  };
  if (element.dataset.controls === undefined) chrome.controls = wanted;
  if (element.dataset.readout === undefined) chrome.readout = wanted;
  /*
   * A quiet figure with only *one* drawing is mounted at the width that drawing was measured at,
   * so the live figure is the same picture the reader was already looking at rather than a
   * re-layout of it. Left to measure its container the runtime re-resolves the scene, the boxes
   * narrow, the labels wrap, and the diagram rearranges itself the moment JavaScript lands — a
   * hydration jump with nothing to justify it when the frame beside it cannot follow.
   *
   * A figure that carries *variants* is the opposite case, and the width is deliberately not
   * pinned. Its frame already answers for its own width — CSS picks the drawing measured for this
   * container — so a runtime that measures the same container resolves the same scene at the same
   * width and draws the same picture. Pinning it here would be the disagreement: the reader would
   * be shown the 320px drawing and then have the 960px one dropped on top of it. Leaving it free
   * also buys the thing a baked drawing can never have — a figure that re-lays-out when the phone
   * is turned, rather than one that keeps the width it happened to load at.
   *
   * An opted-in figure keeps the responsive layout for the same reason it always did: it is a
   * thing to be driven, its chrome already reflows, and nobody reading it is mid-sentence.
   */
  if (wanted === false && element.dataset.kgVariants === undefined) {
    const width = naturalWidth(element);
    if (width !== undefined) chrome.width = width;
  }
  return chrome;
}
