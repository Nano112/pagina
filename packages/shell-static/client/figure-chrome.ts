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
 */

/** The subset of Kineglyph's `MountOptions` this decides. Structural, so no runtime import. */
export interface FigureChrome {
  readonly controls?: boolean | "auto";
  readonly readout?: boolean | "auto";
}

/**
 * The chrome options for one `<figure class="kg">`.
 *
 * Returned as a *partial*: a key that is absent is a key pagina declines to have an opinion about,
 * and Kineglyph's own `data-controls`/`data-readout` parsing stands. That is deliberate — this is
 * spread last over the runtime's dataset-derived options, so returning a value here would
 * overwrite what the author explicitly wrote.
 */
export function figureChrome(element: HTMLElement): FigureChrome {
  // `data-instrument` is the author's word for "this figure is worth poking at". Anything other
  // than "true" (including the attribute being absent) leaves the figure quiet.
  const wanted = element.dataset.instrument === "true" ? "auto" : false;
  const chrome: { controls?: boolean | "auto"; readout?: boolean | "auto" } = {};
  if (element.dataset.controls === undefined) chrome.controls = wanted;
  if (element.dataset.readout === undefined) chrome.readout = wanted;
  return chrome;
}
