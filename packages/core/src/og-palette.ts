/**
 * The card's palette, resolved at generation time instead of at view time.
 *
 * This is deliberately the opposite of what a figure does, and the reason is the consumer rather
 * than the content. A figure is inlined into a page, so it can paint through `var(--kg-color-*)`
 * and follow whatever theme the reader ends up with. A card is a **PNG a crawler fetches on its
 * own**: there is no page, no stylesheet, no `--pg-*` and no `prefers-color-scheme` at the far end
 * of that request. Something has to decide, and the only moment anything can is the build.
 *
 * So the same `--pg-*` contract is read here, from the same files, and turned into literal colours.
 * The ladder is the theme cascade's, minus the levels that do not exist yet at build time:
 *
 *   1. `client/tokens.css` as the shell ships it — the contract's own defaults, read from the file
 *      rather than copied into this one, so a token whose default changes changes the cards too.
 *   2. `article.yaml`'s `theme:`, a stylesheet the article ships.
 *   3. the page's own `theme:`.
 *
 * Each is a plain stylesheet of custom properties, which is what makes three of them compose.
 *
 * Nothing here reads a file. The ladder is {@link composeCardPalette}, which is handed a way to
 * fetch a stylesheet by name — `node:fs` during a build, the editor's store during a publish — so
 * a card composed in a browser resolves its palette off the same three rungs, in the same order,
 * as one composed in Node. Two ladders would be two palettes the day someone edited one of them.
 */
import type { Diagnostic } from "./types.js";
import type { OgScheme } from "./og.js";

/** The `--pg-*` roles a card is drawn from. Everything else in the contract is page furniture. */
export interface CardPalette {
  readonly bg: string;
  readonly raised: string;
  readonly sunken: string;
  readonly fg: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentFg: string;
  readonly line: string;
  readonly lineStrong: string;
}

/**
 * What a card looks like when nothing else says anything.
 *
 * A copy of `tokens.css`'s opening block, and the only copy of it — it exists so a host shell that
 * ships no `tokens.css` still gets a card that looks like pagina rather than a black rectangle.
 * The real file wins whenever there is one, and `test/og-theme.test.ts` checks these against it.
 */
export const DEFAULT_LIGHT: CardPalette = {
  bg: "#ffffff", raised: "#f6f7f9", sunken: "#eceef2",
  fg: "#1a1d23", muted: "#6b7280",
  accent: "#3b5bdb", accentFg: "#ffffff",
  line: "#e3e6eb", lineStrong: "#c8cdd6",
};

export const DEFAULT_DARK: CardPalette = {
  bg: "#14161a", raised: "#1c1f26", sunken: "#0f1115",
  fg: "#e7e9ee", muted: "#9aa1ac",
  accent: "#7c9bff", accentFg: "#0d1117",
  line: "#2b2f38", lineStrong: "#3d434f",
};

/** `--pg-*` name → the field of {@link CardPalette} it fills. */
const ROLES: Readonly<Record<string, keyof CardPalette>> = {
  "--pg-bg": "bg",
  "--pg-bg-raised": "raised",
  "--pg-bg-sunken": "sunken",
  "--pg-fg": "fg",
  "--pg-muted": "muted",
  "--pg-accent": "accent",
  "--pg-accent-fg": "accentFg",
  "--pg-line": "line",
  "--pg-line-strong": "lineStrong",
};

/**
 * A colour this file is willing to bake: `#rgb`, `#rrggbb`, `#rrggbbaa`.
 *
 * Narrow on purpose. The token contract accepts any CSS colour, and a card cannot — the mark's
 * translucent strokes are mixed by hand (Kineglyph paints take a colour, not a colour *and* an
 * alpha), and mixing needs channels. A host writing `oklch(…)` therefore keeps the default for that
 * one role and is told so, which is a card that is slightly off-brand rather than one that is
 * black. Everything else in the palette still comes from the host's own tokens.
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#abc` → `#aabbcc`, so downstream mixing has channels to work with. */
function expandHex(value: string): string {
  if (value.length !== 4 && value.length !== 5) return value.toLowerCase();
  return `#${[...value.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
}

/**
 * Every `--pg-*` declaration in `css`, for one scheme.
 *
 * A regex over stylesheet text rather than a parser, and the limits of that are the documented
 * behaviour: declarations are read wherever they appear, the dark ones are taken from the blocks
 * whose selector mentions `[data-theme="dark"]`, and the light ones from everything else. That
 * covers `tokens.css`, every identity in the theming showcase, and the shape `docs/theming.md`
 * tells a host to write. A stylesheet that themes by some other mechanism — a media query alone, a
 * class on an ancestor — resolves to its light values, which is the same answer pagina's own
 * `data-theme` default gives.
 */
export function readPgTokens(css: string, scheme: OgScheme): Record<string, string> {
  const out: Record<string, string> = {};
  // Strip comments first: a commented-out declaration is not a declaration.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = /([^{}]*)\{([^{}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const selector = block[1] ?? "";
    const body = block[2] ?? "";
    const isDark = /\[data-theme\s*=\s*["']?dark["']?\]/.test(selector);
    if (isDark !== (scheme === "dark")) continue;
    const decls = /(--pg-[\w-]+)\s*:\s*([^;}]+)/g;
    let decl: RegExpExecArray | null;
    while ((decl = decls.exec(body)) !== null) out[decl[1]!] = (decl[2] ?? "").trim();
  }
  return out;
}

/**
 * `base` with every role `css` redefines in a usable colour replaced.
 *
 * Layered rather than replaced, because that is what the cascade does: an article that defines
 * three tokens has themed three things, and the other six are still pagina's.
 */
export function applyTokens(base: CardPalette, tokens: Record<string, string>, source: string, diagnostics: Diagnostic[]): CardPalette {
  const next: Record<string, string> = { ...base };
  for (const [name, role] of Object.entries(ROLES)) {
    const raw = tokens[name];
    if (raw === undefined) continue;
    if (!HEX.test(raw)) {
      diagnostics.push({
        severity: "warning",
        code: "og-token-unbakeable",
        message: `${source} sets ${name} to \`${raw}\`, which social cards cannot bake — they need a hex colour. The card keeps pagina's ${name} for this build.`,
      });
      continue;
    }
    next[role] = expandHex(raw);
  }
  return next as unknown as CardPalette;
}

export interface CardPaletteSources {
  /** `client/tokens.css` as the shell ships it, if it ships one. */
  readonly tokensCss?: string;
  /** The article's `theme:` stylesheet, relative to the folder or an absolute URL. */
  readonly articleTheme?: string;
  /** The page's `theme:` stylesheet, relative to the page, or an absolute URL. */
  readonly pageTheme?: string;
  /** The page's path inside the folder, so its own `theme:` resolves against the right directory. */
  readonly pagePath?: string;
}

/**
 * How {@link composeCardPalette} gets at a stylesheet the article ships.
 *
 * `rel` is as written in the front matter; `dir` is the folder-relative directory it is written
 * relative to (`"."` for `article.yaml`, the page's own directory for a page). Returning
 * `undefined` means "there is no such stylesheet", and the caller has already said so in a
 * diagnostic if it wants to.
 */
export type ReadThemeCss = (rel: string, dir: string) => Promise<string | undefined>;

/** True for anything that is a URL rather than a path inside the article folder. */
export function isRemoteTheme(rel: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rel);
}

/**
 * The palette a card is painted with: the contract's defaults, then the article's theme, then the
 * page's.
 *
 * The rungs and their order are the whole point of this function existing in `@pagina/core` rather
 * than beside either rasteriser. A build reads them off disk and a publish reads them out of the
 * editor's store, and both walk *this* ladder — so the card an author sees drawn in the browser is
 * painted from the same three stylesheets, resolved the same way, as the one the next build writes.
 */
export async function composeCardPalette(
  scheme: OgScheme,
  sources: CardPaletteSources,
  read: ReadThemeCss,
): Promise<{ readonly palette: CardPalette; readonly diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  let palette = scheme === "dark" ? DEFAULT_DARK : DEFAULT_LIGHT;

  const rung = async (rel: string | undefined, dir: string, where: string): Promise<void> => {
    if (rel === undefined) return;
    if (isRemoteTheme(rel)) {
      diagnostics.push({
        severity: "warning",
        code: "og-theme-remote",
        // Fetching it would make the build non-reproducible and non-hermetic, which is the one
        // property the whole card pipeline is built around.
        message: `${where} is a URL (${rel}), and a social card's palette is baked from files at build time — the card uses the tokens this build can read. Ship the stylesheet in the article folder to theme its cards.`,
      });
      return;
    }
    const css = await read(rel, dir);
    if (css === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "og-theme-missing",
        message: `${where} names ${rel}, which is not in the article folder — the card keeps pagina's palette.`,
      });
      return;
    }
    palette = applyTokens(palette, readPgTokens(css, scheme), where, diagnostics);
  };

  if (sources.tokensCss !== undefined)
    palette = applyTokens(palette, readPgTokens(sources.tokensCss, scheme), "the shell's tokens.css", diagnostics);
  await rung(sources.articleTheme, ".", "article.yaml's `theme`");
  // A page's `theme:` is relative to the page, the way its `cover:` is.
  await rung(sources.pageTheme, sources.pagePath === undefined ? "." : `${sources.pagePath}/..`, "the page's `theme`");
  return { palette, diagnostics };
}
