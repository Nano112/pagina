/**
 * The theming showcase's identities, the lab's presets, and the pure functions that turn a token
 * map into the CSS a host pastes.
 *
 * Everything here is data and string-building — no DOM — so the same values feed three consumers
 * that must not drift: the showcase (which renders each identity in a frame *and* prints the CSS
 * it applied), the lab (which applies a preset and exports the CSS), and the unit suite (which
 * checks that every token named here is one `client/tokens.css` actually defines).
 *
 * ## Why the printed CSS is the applied CSS
 *
 * The persuasive claim on the theming page is "this identity is N lines of token mapping". A
 * hand-written listing beside a hand-tuned frame is wrong the moment either is edited, and a docs
 * page that lies about its own numbers is worse than one with no numbers. So the frame is given
 * {@link identityCss}'s output verbatim, the listing prints the same string, and N is counted from
 * it. Nothing here is transcribed twice.
 *
 * ## Why the palettes are hex
 *
 * The lab's colour rows are `<input type="color">`, which speaks nothing else, and a preset that
 * arrived as `oklch(…)` would land in a control that silently rounded it to black. A host is under
 * no such constraint — the contract takes any CSS value, and the lab's text field beside each
 * swatch is there so a reader can type one.
 */

/** A `--pg-*` name mapped to the value a host would give it. */
export type TokenMap = Readonly<Record<string, string>>;

/** How much of pagina's CSS a surface links; the ladder's third rung is `"tokens"`. */
export type ThemeLevel = "full" | "tokens";

export interface Identity {
  /** Stable id: the `data-` hook, the anchor, and the lab's stored choice. */
  readonly id: string;
  readonly name: string;
  /** One line under the name: what kind of site this is. */
  readonly blurb: string;
  /** Which rung of `docs/theming.md`'s ladder this identity stops at. `0` is "changed nothing". */
  readonly rung: 0 | 1 | 2 | 3;
  /** The scheme the frame is shown in, and the `data-theme` its root gets. */
  readonly scheme: "light" | "dark";
  /** The tokens it defines. Anything absent keeps pagina's default, on purpose. */
  readonly tokens: TokenMap;
  /** Rung 2 and 3: ordinary, unlayered rules, which beat pagina's without `!important`. */
  readonly rules?: string;
  /** `"tokens"` links `pagina.tokens.css`, so {@link rules} *is* the content column. */
  readonly themeLevel?: ThemeLevel;
  /** What the reader should notice, printed under the frame. */
  readonly note: string;
}

/** A lab preset: a light map and a dark map, either of which may be empty. */
export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly light: TokenMap;
  readonly dark: TokenMap;
}

/* --------------------------------------------------------------------------------------------
 * The palettes.
 *
 * Each is written once and used twice — as a showcase identity in the scheme it was designed for,
 * and as one half of a lab preset.
 * ------------------------------------------------------------------------------------------ */

/**
 * Almanac — a warm print identity: serif throughout, square corners, a narrower measure, a
 * burnt-sienna accent.
 *
 * It maps **no admonition tokens at all**, which is the point of including it. pagina's defaults
 * still cohere on a cream ground, and a partial map is what most hosts actually write — the ones
 * who care about their prose and have never thought about the hue of a `tip`.
 */
const ALMANAC_LIGHT: TokenMap = {
  "--pg-bg": "#fbf7ef",
  "--pg-bg-raised": "#f4ecdd",
  "--pg-bg-sunken": "#eadfc9",
  "--pg-fg": "#231c12",
  "--pg-muted": "#6b5f4c",
  "--pg-accent": "#8a3f16",
  "--pg-accent-fg": "#fbf7ef",
  "--pg-line": "#e2d6bf",
  "--pg-line-strong": "#bfae90",
  "--pg-radius": "0",
  "--pg-radius-lg": "0",
  "--pg-font": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  "--pg-font-display": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  "--pg-measure": "64ch",
  "--pg-code-bg": "#f2e9d8",
  "--pg-shiki-bg": "#f2e9d8",
};

const ALMANAC_DARK: TokenMap = {
  "--pg-bg": "#191510",
  "--pg-bg-raised": "#221c15",
  "--pg-bg-sunken": "#110e0a",
  "--pg-fg": "#efe6d6",
  "--pg-muted": "#a89a83",
  "--pg-accent": "#e79a5f",
  "--pg-accent-fg": "#191510",
  "--pg-line": "#33291d",
  "--pg-line-strong": "#4d3f2d",
  "--pg-radius": "0",
  "--pg-radius-lg": "0",
  "--pg-font": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  "--pg-font-display": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  "--pg-measure": "64ch",
  "--pg-code-bg": "#221c15",
  "--pg-shiki-bg": "#221c15",
};

/**
 * Console — monospace everywhere, near-square corners, a wide measure and an amber accent on a
 * blue-black ground.
 *
 * Shown at `data-theme="dark"`, and that is the second thing to notice about it: it maps no
 * admonition tokens either, and the callouts are legible because **pagina's own dark defaults are
 * already under it**. A dark identity does not start from nothing.
 */
const CONSOLE_DARK: TokenMap = {
  "--pg-bg": "#0b0d10",
  "--pg-bg-raised": "#12161b",
  "--pg-bg-sunken": "#06080a",
  "--pg-fg": "#d7e0e8",
  "--pg-muted": "#7d8b99",
  "--pg-accent": "#ffb454",
  "--pg-accent-fg": "#0b0d10",
  "--pg-line": "#1d242c",
  "--pg-line-strong": "#313c47",
  "--pg-radius": "2px",
  "--pg-radius-lg": "3px",
  "--pg-font": 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  "--pg-font-display": 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  "--pg-measure": "78ch",
  "--pg-code-bg": "#12161b",
  "--pg-shiki-bg": "#0f1318",
};

const CONSOLE_LIGHT: TokenMap = {
  "--pg-bg": "#f7f7f4",
  "--pg-bg-raised": "#ecece7",
  "--pg-bg-sunken": "#e2e2db",
  "--pg-fg": "#16181a",
  "--pg-muted": "#5c6470",
  "--pg-accent": "#a35a00",
  "--pg-accent-fg": "#ffffff",
  "--pg-line": "#dcdcd4",
  "--pg-line-strong": "#b9b9ae",
  "--pg-radius": "2px",
  "--pg-radius-lg": "3px",
  "--pg-font": 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  "--pg-font-display": 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  "--pg-measure": "78ch",
  "--pg-code-bg": "#ecece7",
  "--pg-shiki-bg": "#ecece7",
};

/**
 * Orchid — accent-led and dark: violet ink on a violet-cast ground, generous corners, a `note`
 * retinted into the accent's family so the callouts belong to the brand rather than to pagina.
 *
 * The three `--pg-note-*` lines are the demonstration that an admonition is retinted by defining
 * tokens and never by overriding a rule.
 */
const ORCHID_DARK: TokenMap = {
  "--pg-bg": "#120f1c",
  "--pg-bg-raised": "#1b1730",
  "--pg-bg-sunken": "#0b0915",
  "--pg-fg": "#ece7fb",
  "--pg-muted": "#9d93bd",
  "--pg-accent": "#b388ff",
  "--pg-accent-fg": "#120f1c",
  "--pg-line": "#2a2445",
  "--pg-line-strong": "#3f3663",
  "--pg-radius": "14px",
  "--pg-radius-lg": "20px",
  "--pg-measure": "70ch",
  "--pg-code-bg": "#1b1730",
  "--pg-shiki-bg": "#16122a",
  "--pg-note": "#b388ff",
  "--pg-note-surface": "#1d1733",
  "--pg-note-fg": "#cdb4ff",
};

const ORCHID_LIGHT: TokenMap = {
  "--pg-bg": "#fbf9ff",
  "--pg-bg-raised": "#f3eeff",
  "--pg-bg-sunken": "#e9e2fa",
  "--pg-fg": "#1c1630",
  "--pg-muted": "#6a6088",
  "--pg-accent": "#6d3ee0",
  "--pg-accent-fg": "#ffffff",
  "--pg-line": "#e4dcf6",
  "--pg-line-strong": "#c6b8e8",
  "--pg-radius": "14px",
  "--pg-radius-lg": "20px",
  "--pg-measure": "70ch",
  "--pg-code-bg": "#f3eeff",
  "--pg-shiki-bg": "#f3eeff",
  "--pg-note": "#6d3ee0",
  "--pg-note-surface": "#f1ebff",
  "--pg-note-fg": "#4b2a9e",
};

/** Broadsheet — a newspaper: black ink, a red accent, and headings that are a rule and a rhythm. */
const BROADSHEET_LIGHT: TokenMap = {
  "--pg-bg": "#ffffff",
  "--pg-bg-raised": "#f2f2f0",
  "--pg-bg-sunken": "#e8e8e4",
  "--pg-fg": "#14100e",
  "--pg-muted": "#5f5a55",
  "--pg-accent": "#b3261e",
  "--pg-accent-fg": "#ffffff",
  "--pg-line": "#dedad4",
  "--pg-line-strong": "#14100e",
  "--pg-radius": "0",
  "--pg-radius-lg": "0",
  "--pg-font": 'Georgia, "Times New Roman", serif',
  "--pg-font-display": '"Helvetica Neue", Helvetica, Arial, sans-serif',
  "--pg-measure": "68ch",
};

/**
 * The rules half of Broadsheet. Ordinary selectors, no `!important`, no `:where()` — they win
 * because pagina's equivalents are inside `@layer pagina.reading` and these are not.
 */
const BROADSHEET_RULES = `.pg-content h1 { font-size: 3rem; line-height: 1.02; letter-spacing: -0.02em; }
.pg-content h2 {
  font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.18em;
  border-top: 3px solid var(--pg-line-strong);
  padding-top: 0.55rem; margin-top: 2.6rem;
}
.pg-content > p:first-of-type { font-size: 1.15rem; }
.pg-content > p:first-of-type::first-letter {
  float: left; font-family: var(--pg-font-display); font-weight: 700;
  font-size: 3.2em; line-height: 0.8; padding-right: 0.08em;
}
.pg-content table { font-variant-numeric: tabular-nums; }`;

/** Bare column — the rung-3 host: pagina's tokens and markup, its own content column. */
const BARE_TOKENS: TokenMap = {
  "--pg-bg": "#ffffff",
  "--pg-bg-raised": "#f4f6f7",
  "--pg-bg-sunken": "#e9edef",
  "--pg-fg": "#101418",
  "--pg-muted": "#55606b",
  "--pg-accent": "#0f766e",
  "--pg-accent-fg": "#ffffff",
  "--pg-line": "#dfe4e8",
  "--pg-line-strong": "#b7c0c7",
  "--pg-radius": "4px",
  "--pg-measure": "68ch",
};

/**
 * Everything the reading layer was doing, written out by a host that took `theme: "tokens"`.
 *
 * It is here at full length precisely because the length is the argument: this is the rung where
 * pagina stops helping, and a reader deciding between rung 1 and rung 3 should be able to see what
 * the difference costs before they choose.
 */
const BARE_RULES = `.pg-content { max-inline-size: var(--pg-measure); line-height: 1.7; }
.pg-content h1 { font-size: 2rem; letter-spacing: -0.01em; margin: 0 0 1rem; }
.pg-content h2 {
  font-size: 1.2rem; margin: 2.2rem 0 0.6rem;
  padding-inline-start: 0.6rem; border-inline-start: 3px solid var(--pg-accent);
}
.pg-content p, .pg-content ul, .pg-content table, .pg-content pre { margin: 0 0 1.1rem; }
.pg-content a { color: var(--pg-accent); }
.pg-content code {
  font-family: var(--pg-font-mono); font-size: 0.9em;
  background: var(--pg-bg-raised); padding: 0.1em 0.32em; border-radius: var(--pg-radius);
}
.pg-content pre {
  background: var(--pg-bg-sunken); padding: 0.9rem 1rem;
  overflow-x: auto; border-radius: var(--pg-radius);
}
.pg-content pre code { background: none; padding: 0; }
.pg-content table { border-collapse: collapse; inline-size: 100%; }
.pg-content th, .pg-content td {
  border-block-end: 1px solid var(--pg-line); padding: 0.4rem 0.6rem; text-align: start;
}
.pg-content th { background: var(--pg-bg-sunken); }
.pg-admonition {
  border: 1px solid var(--pg-line); border-inline-start: 3px solid var(--pg-accent);
  padding: 0.7rem 1rem; margin: 1.2rem 0; border-radius: var(--pg-radius);
}
.pg-admonition__title {
  display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.35rem; font-weight: 700;
}
.pg-admonition__icon { inline-size: 1.1em; block-size: 1.1em; }
.pg-admonition p:last-child { margin: 0; }
figure.kg { margin: 1.4rem 0; }
figure.kg svg { max-inline-size: 100%; block-size: auto; }
figure.kg figcaption { color: var(--pg-muted); font-size: 0.85rem; margin-top: 0.4rem; }`;

/* --------------------------------------------------------------------------------------------
 * CSS building. Pure, and the single source of every line count printed on the page.
 * ------------------------------------------------------------------------------------------ */

/** One `selector { … }` block, or `""` for an empty map — never an empty rule. */
export function tokenBlock(selector: string, tokens: TokenMap): string {
  const entries = Object.entries(tokens);
  if (entries.length === 0) return "";
  return `${selector} {\n${entries.map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}`;
}

/**
 * The two blocks a host pastes: the light map on `:root`, the dark map on `:root[data-theme=…]`.
 *
 * `:root` rather than `html` because that is what `docs/theming.md` shows, and unlayered rather
 * than inside `@layer` because unlayered is what makes a host's values win — pasting this into a
 * sheet loaded before pagina's works for the same reason.
 */
export function themeCss(light: TokenMap, dark: TokenMap): string {
  return [tokenBlock(":root", light), tokenBlock(':root[data-theme="dark"]', dark)]
    .filter((block) => block !== "")
    .join("\n\n");
}

/** Everything an identity contributes, in the order a host's file would have it. */
export function identityCss(identity: Identity): string {
  const tokens = tokenBlock(":root", identity.tokens);
  return [tokens, identity.rules ?? ""].filter((part) => part !== "").join("\n\n");
}

/** How many lines the reader is being asked to accept. Counted, never transcribed. */
export function lineCount(css: string): number {
  const trimmed = css.trim();
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}

/* --------------------------------------------------------------------------------------------
 * The published lists.
 * ------------------------------------------------------------------------------------------ */

export const IDENTITIES: readonly Identity[] = [
  {
    id: "default",
    name: "pagina, as it ships",
    blurb: "The neutral default: nothing mapped, nothing overridden.",
    rung: 0,
    scheme: "light",
    tokens: {},
    note: "The control. Every frame below renders this same markup — only the CSS beside it differs.",
  },
  {
    id: "almanac",
    name: "Almanac",
    blurb: "A print identity: serif throughout, square corners, a narrower measure.",
    rung: 1,
    scheme: "light",
    tokens: ALMANAC_LIGHT,
    note: "No admonition token is mapped. pagina's defaults still cohere on a cream ground, which is what a partial map buys you.",
  },
  {
    id: "console",
    name: "Console",
    blurb: "Monospace, dense, amber on blue-black. Deliberately nothing like the default.",
    rung: 1,
    scheme: "dark",
    tokens: CONSOLE_DARK,
    note: "It maps no admonition tokens either — the callouts read because pagina's own dark defaults are underneath. A dark identity does not start from nothing.",
  },
  {
    id: "orchid",
    name: "Orchid",
    blurb: "Accent-led: a violet ground, soft corners, callouts pulled into the brand.",
    rung: 1,
    scheme: "dark",
    tokens: ORCHID_DARK,
    note: "The last three lines retint the `note` callout. An admonition changes hue by defining tokens, never by overriding a rule.",
  },
  {
    id: "broadsheet",
    name: "Broadsheet",
    blurb: "Tokens, plus five ordinary rules that change the reading rhythm itself.",
    rung: 2,
    scheme: "light",
    tokens: BROADSHEET_LIGHT,
    rules: BROADSHEET_RULES,
    note: "Rung 2. Those selectors carry no `!important` and no id — they win because pagina's live in `@layer pagina.reading` and these do not.",
  },
  {
    id: "bare",
    name: "Bare column",
    blurb: 'theme: "tokens" — pagina\'s markup and variables, somebody else\'s content column.',
    rung: 3,
    scheme: "light",
    tokens: BARE_TOKENS,
    rules: BARE_RULES,
    themeLevel: "tokens",
    note: "Rung 3: this frame links `pagina.tokens.css`, so the reading layer is not there at all. The length of the listing is the argument — that is what the layer was doing for you.",
  },
];

/**
 * The lab's presets.
 *
 * Each reuses a showcase palette for the scheme it was designed in and pairs it with a counterpart
 * for the other, because the lab exports *both* blocks and a preset that themed only half of a
 * host's site would export a half-finished file.
 */
export const PRESETS: readonly Preset[] = [
  {
    id: "default",
    name: "pagina",
    blurb: "The shipped defaults. Picking this exports nothing, because there is nothing to say.",
    light: {},
    dark: {},
  },
  {
    id: "almanac",
    name: "Almanac",
    blurb: "Warm print, serif, square corners.",
    light: ALMANAC_LIGHT,
    dark: ALMANAC_DARK,
  },
  {
    id: "console",
    name: "Console",
    blurb: "Monospace and dense, amber accent.",
    light: CONSOLE_LIGHT,
    dark: CONSOLE_DARK,
  },
  {
    id: "orchid",
    name: "Orchid",
    blurb: "Accent-led violet, soft corners, retinted notes.",
    light: ORCHID_LIGHT,
    dark: ORCHID_DARK,
  },
  {
    id: "broadsheet",
    name: "Broadsheet",
    blurb: "Newspaper black and red. (The showcase adds rules; this is the token half.)",
    light: BROADSHEET_LIGHT,
    dark: {},
  },
];
