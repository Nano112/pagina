/**
 * Which `--pg-*` the lab offers a control for, in which group, and what kind of control.
 *
 * This is a *view* of the token contract, not a second copy of it: `test/theming-lab.test.ts`
 * asserts that every name here is defined in `client/tokens.css` and that every colour token
 * `tokens.css` defines is reachable from some group. A token added to the contract and forgotten
 * here fails that test rather than quietly becoming the one thing the widget cannot change.
 *
 * `kind` decides the control and nothing else. `"color"` gets a swatch *and* a text field, because
 * `<input type="color">` speaks only `#rrggbb` and the contract takes any CSS colour — the swatch
 * is the convenience, the text field is the contract.
 */

export type TokenKind = "color" | "text";

export interface TokenControl {
  readonly name: string;
  /** What it draws, in the reader's words rather than the variable's. */
  readonly label: string;
  readonly kind: TokenKind;
}

export interface TokenGroup {
  readonly label: string;
  /** Groups past the first few open on request: a wall of 35 rows is not a control panel. */
  readonly open: boolean;
  readonly tokens: readonly TokenControl[];
}

const admonition = (kind: string, label: string): TokenControl[] => [
  { name: `--pg-${kind}`, label: `${label} — edge and glyph`, kind: "color" },
  { name: `--pg-${kind}-surface`, label: `${label} — ground`, kind: "color" },
  { name: `--pg-${kind}-fg`, label: `${label} — title`, kind: "color" },
];

export const TOKEN_GROUPS: readonly TokenGroup[] = [
  {
    label: "Surfaces and ink",
    open: true,
    tokens: [
      { name: "--pg-bg", label: "Page", kind: "color" },
      { name: "--pg-bg-raised", label: "Raised — callouts, the toggle", kind: "color" },
      { name: "--pg-bg-sunken", label: "Sunken — table headers", kind: "color" },
      { name: "--pg-fg", label: "Body text", kind: "color" },
      { name: "--pg-muted", label: "Secondary text and captions", kind: "color" },
    ],
  },
  {
    label: "Accent and rules",
    open: true,
    tokens: [
      { name: "--pg-accent", label: "Links, current nav, figure accents", kind: "color" },
      { name: "--pg-accent-fg", label: "Text drawn on the accent", kind: "color" },
      { name: "--pg-line", label: "Ordinary borders", kind: "color" },
      { name: "--pg-line-strong", label: "Emphasised rules, figure outlines", kind: "color" },
    ],
  },
  {
    label: "Shape and type",
    open: true,
    tokens: [
      { name: "--pg-radius", label: "Corner radius", kind: "text" },
      { name: "--pg-radius-lg", label: "Corner radius, large surfaces", kind: "text" },
      { name: "--pg-measure", label: "Content column width", kind: "text" },
      { name: "--pg-font", label: "Body face", kind: "text" },
      { name: "--pg-font-display", label: "Headings and the site title", kind: "text" },
      { name: "--pg-font-mono", label: "Code face", kind: "text" },
    ],
  },
  {
    label: "Code",
    open: false,
    tokens: [
      { name: "--pg-code-bg", label: "Inline code and plain blocks", kind: "color" },
      { name: "--pg-shiki-bg", label: "Highlighted code blocks", kind: "color" },
    ],
  },
  {
    label: "Figures",
    open: false,
    tokens: [
      { name: "--pg-figure-max", label: "How wide a figure may get", kind: "text" },
      { name: "--pg-figure-min-scale", label: "Scale floor before it scrolls", kind: "text" },
    ],
  },
  {
    label: "Admonitions",
    open: false,
    tokens: [
      ...admonition("note", "note"),
      ...admonition("tip", "tip"),
      ...admonition("info", "info"),
      ...admonition("warning", "warning"),
      ...admonition("danger", "danger"),
      ...admonition("example", "example"),
      ...admonition("quote", "quote"),
    ],
  },
];

/** Every token the lab can set, in the order it presents them. */
export const CONTROLLED_TOKENS: readonly TokenControl[] = TOKEN_GROUPS.flatMap((g) => [...g.tokens]);
