/**
 * The theme lab: live controls that retint the page by writing the documented `--pg-*` tokens, and
 * nothing else.
 *
 * ## The one design decision everything else follows from
 *
 * The lab does not set properties on elements, and it does not touch a single pagina rule. It keeps
 * one `<style data-pg-theme-lab>` in the head whose text is exactly
 *
 * ```css
 * :root { … }
 * :root[data-theme="dark"] { … }
 * ```
 *
 * — and the export panel prints *that string*. So "copy this and paste it into your site" is true
 * by construction rather than by careful maintenance: there is one artefact, the page is wearing it,
 * and the reader is looking at it. A widget that applied inline styles and then generated a
 * plausible-looking snippet would be a demo of a snippet generator, not of the token contract.
 *
 * It also means every surface follows at once and for free, because that is what the contract
 * already says: prose and chrome read `--pg-*` directly, the editor's `--pge-*` inherit from them,
 * and a Kineglyph figure's every paint is a `var(--kg-color-…)` that `tokens.css` points at a
 * `--pg-*`. Nothing here knows that a figure exists.
 *
 * ## Two blocks, not one
 *
 * Colours are per-scheme and geometry is not — `tokens.css` redefines only colours under
 * `[data-theme="dark"]`, and the lab exports the same shape. A control whose kind is `"text"`
 * (radius, measure, the three faces, the figure limits) therefore always writes into the light
 * block however the page is currently being previewed, so an exported file never claims a site's
 * corner radius depends on its colour scheme.
 */
import { CONTROLLED_TOKENS, TOKEN_GROUPS, type TokenControl } from "./catalogue.js";
import { PRESETS, type Preset, themeCss } from "./identities.js";

export interface ThemeLabOptions {
  /**
   * `false` (the default) mounts a panel where it stands — the theming page, in prose.
   * `true` mounts a launcher pinned to the corner of the viewport and a drawer behind it, for a
   * surface that has no prose to sit in: the full-screen editor.
   */
  readonly floating?: boolean;
  /** localStorage key. One per surface would mean the editor and the docs disagreed. */
  readonly storageKey?: string;
  /** The document to theme. Defaults to the one the module is running in. */
  readonly doc?: Document;
}

/** What a caller (and the e2e suite) can do to a mounted lab without going through the DOM. */
export interface ThemeLabHandle {
  /** The CSS currently applied — byte for byte what the export panel shows. */
  css(): string;
  /** Apply a preset by id. Unknown ids are ignored. */
  setPreset(id: string): void;
  /** Set one token in the scheme it belongs to. */
  setToken(name: string, value: string): void;
  /** Back to pagina's defaults, and forget the stored choice. */
  reset(): void;
  /** Remove the lab's UI and its stylesheet. */
  destroy(): void;
}

type Scheme = "light" | "dark";

interface State {
  presetId: string;
  light: Record<string, string>;
  dark: Record<string, string>;
}

const STORAGE_KEY = "pagina-theme-lab";
const STYLE_ATTR = "data-pg-theme-lab";
/** Custom, i.e. "a preset was picked and then edited, or nothing was picked at all". */
const CUSTOM = "custom";

const BY_NAME = new Map(CONTROLLED_TOKENS.map((t) => [t.name, t]));
/** A token whose value cannot depend on the colour scheme. See the module comment. */
const isSchemeIndependent = (name: string): boolean => BY_NAME.get(name)?.kind === "text";

const el = <K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = doc.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/* --------------------------------------------------------------------------------------------
 * Reading the defaults.
 * ------------------------------------------------------------------------------------------ */

/**
 * The value every control shows before anyone touches it, for both schemes.
 *
 * Dark's defaults cannot be read while the page is in light: `[data-theme="dark"]` matches the root
 * element and nothing else, so there is no probe element to hang it on. The flip below is therefore
 * real — and harmless, because it is synchronous. Style is recomputed on demand for
 * `getPropertyValue`; no frame is produced between the two writes, so nothing is ever painted in
 * the wrong scheme. It has to happen before the lab's own stylesheet exists, or it would read the
 * lab's values back as the defaults.
 */
function readDefaults(doc: Document): Record<Scheme, Record<string, string>> {
  const root = doc.documentElement;
  const before = root.dataset["theme"];
  const view = doc.defaultView;
  const read = (): Record<string, string> => {
    const out: Record<string, string> = {};
    if (view === null) return out;
    const computed = view.getComputedStyle(root);
    for (const token of CONTROLLED_TOKENS) {
      const value = computed.getPropertyValue(token.name).trim();
      if (value !== "") out[token.name] = value;
    }
    return out;
  };
  root.dataset["theme"] = "light";
  const light = read();
  root.dataset["theme"] = "dark";
  const dark = read();
  if (before === undefined) delete root.dataset["theme"];
  else root.dataset["theme"] = before;
  return { light, dark };
}

/* --------------------------------------------------------------------------------------------
 * State ↔ CSS ↔ storage. Pure enough to unit-test.
 * ------------------------------------------------------------------------------------------ */

/**
 * A preset as two exportable blocks: colours split by scheme, geometry hoisted into light.
 *
 * The identity maps are written to be self-contained, because the showcase renders each one on its
 * own in a single scheme. The lab exports both blocks at once, so the geometry a dark map restates
 * would otherwise appear twice in the snippet and imply it could differ.
 */
export function splitPreset(preset: Preset): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const [name, value] of Object.entries(preset.light)) light[name] = value;
  for (const [name, value] of Object.entries(preset.dark)) {
    if (isSchemeIndependent(name)) light[name] ??= value;
    else dark[name] = value;
  }
  return { light, dark };
}

const cssFor = (state: State): string => themeCss(state.light, state.dark);

function load(view: Window, key: string): State | undefined {
  try {
    const raw = view.localStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { presetId, light, dark } = parsed as Partial<State>;
    // Only strings, and only tokens this build still has a control for: a stored map from an older
    // deployment must not be able to write an arbitrary custom property into the page.
    const clean = (map: unknown): Record<string, string> => {
      const out: Record<string, string> = {};
      if (typeof map !== "object" || map === null) return out;
      for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
        if (typeof value === "string" && BY_NAME.has(name)) out[name] = value;
      }
      return out;
    };
    return { presetId: typeof presetId === "string" ? presetId : CUSTOM, light: clean(light), dark: clean(dark) };
  } catch {
    return undefined;
  }
}

/* --------------------------------------------------------------------------------------------
 * The lab's own chrome.
 *
 * Every value is a `--pg-*`, for the reason the demo's is: this runs inside pagina's docs today and
 * could run inside anything tomorrow — and a control panel for a theme that did not follow the
 * theme would be a strange thing to ship. Transitions are opt-in under `prefers-reduced-motion`.
 * ------------------------------------------------------------------------------------------ */

const LAB_CSS = `
.pgl { display: block; color: var(--pg-fg); font-family: var(--pg-font); font-size: 0.9rem; }
.pgl__panel {
  border: 1px solid var(--pg-line); border-radius: var(--pg-radius-lg);
  background: var(--pg-bg-raised); padding: 1rem; display: grid; gap: 0.9rem;
}
.pgl__row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.pgl__legend { font-weight: 600; font-family: var(--pg-font-display); margin: 0; }
.pgl__hint { color: var(--pg-muted); font-size: 0.82rem; margin: 0; }
.pgl__presets { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0; padding: 0; border: 0; }
.pgl__button {
  font: inherit; cursor: pointer; padding: 0.32rem 0.7rem;
  border: 1px solid var(--pg-line-strong); border-radius: var(--pg-radius);
  background: var(--pg-bg); color: var(--pg-fg);
}
.pgl__button[aria-pressed="true"] { background: var(--pg-accent); color: var(--pg-accent-fg); border-color: var(--pg-accent); }
.pgl__button:focus-visible, .pgl__swatch:focus-visible, .pgl__text:focus-visible, .pgl__summary:focus-visible {
  outline: 2px solid var(--pg-accent); outline-offset: 2px;
}
.pgl__group { border: 1px solid var(--pg-line); border-radius: var(--pg-radius); background: var(--pg-bg); }
.pgl__summary { cursor: pointer; padding: 0.45rem 0.7rem; font-weight: 600; list-style-position: inside; }
.pgl__tokens { display: grid; gap: 0.5rem; padding: 0 0.7rem 0.7rem; }
.pgl__token { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.25rem; }
.pgl__label { color: var(--pg-muted); font-size: 0.78rem; }
.pgl__label code { font-family: var(--pg-font-mono); font-size: 0.95em; color: var(--pg-fg); }
.pgl__inputs { display: flex; gap: 0.4rem; align-items: center; }
.pgl__swatch {
  inline-size: 2.4rem; block-size: 2rem; padding: 0; flex: none;
  border: 1px solid var(--pg-line-strong); border-radius: var(--pg-radius); background: var(--pg-bg);
}
.pgl__text {
  font: inherit; font-family: var(--pg-font-mono); font-size: 0.82rem;
  flex: 1 1 6rem; min-inline-size: 0; padding: 0.3rem 0.45rem;
  border: 1px solid var(--pg-line-strong); border-radius: var(--pg-radius);
  background: var(--pg-bg); color: var(--pg-fg);
}
.pgl__export { display: grid; gap: 0.4rem; }
.pgl__code {
  margin: 0; max-block-size: 15rem; overflow: auto; padding: 0.7rem;
  border: 1px solid var(--pg-line); border-radius: var(--pg-radius);
  background: var(--pg-bg-sunken); color: var(--pg-fg);
  font-family: var(--pg-font-mono); font-size: 0.78rem; line-height: 1.5;
  white-space: pre; tab-size: 2;
}
.pgl__status { color: var(--pg-muted); font-size: 0.8rem; min-block-size: 1.2em; }

/* Floating: a launcher and a drawer, for a surface with no prose to sit in. */
.pgl--floating { position: fixed; inset-block-end: 1rem; inset-inline-end: 1rem; z-index: 40; display: grid; justify-items: end; gap: 0.5rem; }
.pgl--floating .pgl__panel {
  inline-size: min(24rem, calc(100vw - 2rem)); max-block-size: min(70dvh, 40rem); overflow: auto;
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.28);
}
.pgl--floating[data-open="false"] .pgl__panel { display: none; }
@media (max-width: 30rem) {
  .pgl--floating { inset-inline: 0.5rem; inset-block-end: 0.5rem; justify-items: stretch; }
  .pgl--floating .pgl__panel { inline-size: auto; }
}
@media (prefers-reduced-motion: no-preference) {
  .pgl__button { transition: background-color 120ms ease, color 120ms ease; }
}
`;

function injectStyles(doc: Document): void {
  if (doc.querySelector("style[data-pagina-theme-lab-css]") !== null) return;
  const style = doc.createElement("style");
  style.setAttribute("data-pagina-theme-lab-css", "");
  style.textContent = LAB_CSS;
  doc.head.appendChild(style);
}

/* --------------------------------------------------------------------------------------------
 * Mount.
 * ------------------------------------------------------------------------------------------ */

export function mountThemeLab(host: HTMLElement, options: ThemeLabOptions = {}): ThemeLabHandle {
  const doc = options.doc ?? host.ownerDocument;
  const view = doc.defaultView;
  const key = options.storageKey ?? STORAGE_KEY;
  const floating = options.floating ?? true;
  const root = doc.documentElement;

  // Before anything is injected, or the lab would read its own values back as the defaults.
  const defaults = readDefaults(doc);

  const state: State =
    (view === null ? undefined : load(view, key)) ?? { presetId: "default", light: {}, dark: {} };

  injectStyles(doc);

  const sheet = doc.createElement("style");
  sheet.setAttribute(STYLE_ATTR, "");
  doc.head.appendChild(sheet);

  const scheme = (): Scheme => (root.dataset["theme"] === "dark" ? "dark" : "light");

  host.classList.add("pgl");
  if (floating) host.classList.add("pgl--floating");
  host.replaceChildren();

  const panel = el(doc, "div", "pgl__panel");
  panel.id = `pgl-panel-${String(Math.trunc(Math.random() * 1e9))}`;

  let launcher: HTMLButtonElement | undefined;
  if (floating) {
    launcher = el(doc, "button", "pgl__button", "Theme");
    launcher.type = "button";
    // `data-pg-lab-*` hooks throughout: `e2e/theme-lab.spec.ts` drives this panel the way a reader
    // does, and a spec that found its controls by visible text would break on a wording change.
    launcher.dataset["pgLabLauncher"] = "";
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", panel.id);
    host.dataset["open"] = "false";
    launcher.addEventListener("click", () => {
      const open = host.dataset["open"] !== "true";
      host.dataset["open"] = String(open);
      launcher?.setAttribute("aria-expanded", String(open));
    });
    host.append(launcher);
    host.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || host.dataset["open"] !== "true") return;
      host.dataset["open"] = "false";
      launcher?.setAttribute("aria-expanded", "false");
      launcher?.focus();
    });
  }
  host.append(panel);

  /* --- header ------------------------------------------------------------------------------ */

  const head = el(doc, "div", "pgl__row");
  head.append(el(doc, "p", "pgl__legend", "Theme lab"));
  const schemeGroup = el(doc, "div", "pgl__row");
  schemeGroup.setAttribute("role", "group");
  schemeGroup.setAttribute("aria-label", "Preview scheme");
  const schemeButtons: Record<Scheme, HTMLButtonElement> = {
    light: el(doc, "button", "pgl__button", "Light"),
    dark: el(doc, "button", "pgl__button", "Dark"),
  };
  for (const which of ["light", "dark"] as const) {
    const button = schemeButtons[which];
    button.type = "button";
    button.dataset["pgLabScheme"] = which;
    button.addEventListener("click", () => {
      root.dataset["theme"] = which;
      // The same key the shell's inline `<head>` script and the site's toggle use, so the lab's
      // preview and the reader's own choice are one setting rather than two that fight.
      try {
        view?.localStorage.setItem("pagina-theme", which);
      } catch {
        /* private mode */
      }
      render();
    });
    schemeGroup.append(button);
  }
  head.append(schemeGroup);
  panel.append(head);

  panel.append(
    el(doc, "p", "pgl__hint",
      "Everything below writes a documented --pg-* token and nothing else. Prose, code, callouts, tables, the editor and the diagrams all follow, because they all read the same variables."),
  );

  /* --- presets ----------------------------------------------------------------------------- */

  const presetBox = el(doc, "fieldset", "pgl__presets");
  const presetLegend = el(doc, "legend", "pgl__label", "Presets");
  presetBox.append(presetLegend);
  const presetButtons = new Map<string, HTMLButtonElement>();
  for (const preset of PRESETS) {
    const button = el(doc, "button", "pgl__button", preset.name);
    button.type = "button";
    button.dataset["pgLabPreset"] = preset.id;
    button.title = preset.blurb;
    button.addEventListener("click", () => {
      applyPreset(preset);
    });
    presetButtons.set(preset.id, button);
    presetBox.append(button);
  }
  panel.append(presetBox);

  /* --- token groups ------------------------------------------------------------------------ */

  const swatches = new Map<string, HTMLInputElement>();
  const texts = new Map<string, HTMLInputElement>();

  for (const group of TOKEN_GROUPS) {
    const details = el(doc, "details", "pgl__group");
    details.open = group.open;
    const summary = el(doc, "summary", "pgl__summary", group.label);
    details.append(summary);
    const list = el(doc, "div", "pgl__tokens");
    for (const token of group.tokens) list.append(tokenRow(token));
    details.append(list);
    panel.append(details);
  }

  function tokenRow(token: TokenControl): HTMLElement {
    const row = el(doc, "div", "pgl__token");
    const label = el(doc, "label", "pgl__label");
    const id = `pgl-${token.name.slice(2)}`;
    label.htmlFor = `${id}-text`;
    label.append(doc.createTextNode(`${token.label} `));
    const code = el(doc, "code", undefined, token.name);
    label.append(code);
    row.append(label);

    const inputs = el(doc, "div", "pgl__inputs");
    if (token.kind === "color") {
      const swatch = el(doc, "input", "pgl__swatch");
      swatch.type = "color";
      swatch.id = `${id}-swatch`;
      // The swatch is a convenience over the text field, which is the contract; it is labelled
      // rather than left to inherit the `<label>`'s `for`, which points at the text field.
      swatch.setAttribute("aria-label", `${token.label}, colour picker`);
      swatch.addEventListener("input", () => {
        setToken(token.name, swatch.value);
      });
      swatches.set(token.name, swatch);
      inputs.append(swatch);
    }
    const text = el(doc, "input", "pgl__text");
    text.type = "text";
    text.id = `${id}-text`;
    text.dataset["pgLabToken"] = token.name;
    text.spellcheck = false;
    text.addEventListener("change", () => {
      setToken(token.name, text.value.trim());
    });
    texts.set(token.name, text);
    inputs.append(text);
    row.append(inputs);
    return row;
  }

  /* --- export ------------------------------------------------------------------------------ */

  const exportBox = el(doc, "div", "pgl__export");
  exportBox.append(
    el(doc, "p", "pgl__hint",
      "This is the stylesheet the page is wearing. Paste it into a sheet your host loads after pagina's — unlayered, so it wins — and your site looks like this."),
  );
  const code = el(doc, "pre", "pgl__code");
  code.tabIndex = 0;
  code.dataset["pgLabExport"] = "";
  code.setAttribute("aria-label", "The CSS to copy");
  exportBox.append(code);
  const actions = el(doc, "div", "pgl__row");
  const copy = el(doc, "button", "pgl__button", "Copy the CSS");
  copy.type = "button";
  copy.dataset["pgLabCopy"] = "";
  const status = el(doc, "span", "pgl__status");
  status.setAttribute("role", "status");
  copy.addEventListener("click", () => {
    const text = cssFor(state);
    const clipboard = view?.navigator.clipboard;
    if (clipboard === undefined) {
      status.textContent = "Select the block above and copy it.";
      return;
    }
    void clipboard.writeText(text).then(
      () => (status.textContent = "Copied."),
      () => (status.textContent = "Copying was blocked; select the block above instead."),
    );
  });
  const resetButton = el(doc, "button", "pgl__button", "Reset");
  resetButton.type = "button";
  resetButton.dataset["pgLabReset"] = "";
  resetButton.addEventListener("click", () => {
    reset();
  });
  actions.append(copy, resetButton, status);
  exportBox.append(actions);
  panel.append(exportBox);

  /* --- behaviour --------------------------------------------------------------------------- */

  function persist(): void {
    try {
      if (state.presetId === "default" && Object.keys(state.light).length === 0 && Object.keys(state.dark).length === 0) {
        view?.localStorage.removeItem(key);
      } else {
        view?.localStorage.setItem(key, JSON.stringify(state));
      }
    } catch {
      /* private mode / storage disabled: the lab still works for this page view */
    }
  }

  function apply(): void {
    sheet.textContent = cssFor(state);
  }

  function applyPreset(preset: Preset): void {
    const split = splitPreset(preset);
    state.presetId = preset.id;
    state.light = split.light;
    state.dark = split.dark;
    apply();
    persist();
    render();
  }

  function setToken(name: string, value: string): void {
    const target = isSchemeIndependent(name) ? state.light : state[scheme()];
    if (value === "") delete target[name];
    else target[name] = value;
    state.presetId = CUSTOM;
    apply();
    persist();
    render();
  }

  function reset(): void {
    state.presetId = "default";
    state.light = {};
    state.dark = {};
    apply();
    persist();
    render();
    status.textContent = "Back to pagina's defaults.";
  }

  /** What a control should show: the override if there is one, else the shipped default. */
  function valueOf(token: TokenControl): string {
    const which: Scheme = isSchemeIndependent(token.name) ? "light" : scheme();
    return state[which][token.name] ?? defaults[which][token.name] ?? "";
  }

  function render(): void {
    const now = scheme();
    for (const which of ["light", "dark"] as const) {
      schemeButtons[which].setAttribute("aria-pressed", String(which === now));
    }
    for (const [id, button] of presetButtons) {
      button.setAttribute("aria-pressed", String(id === state.presetId));
    }
    for (const token of CONTROLLED_TOKENS) {
      const value = valueOf(token);
      const text = texts.get(token.name);
      if (text !== undefined && doc.activeElement !== text) text.value = value;
      const swatch = swatches.get(token.name);
      // `<input type="color">` refuses anything but `#rrggbb`; leaving it alone is better than
      // resetting it to black, and the text field beside it is showing the real value anyway.
      if (swatch !== undefined && /^#[0-9a-fA-F]{6}$/.test(value)) swatch.value = value.toLowerCase();
    }
    const css = cssFor(state);
    code.textContent = css === "" ? "/* Nothing to export — this is pagina, unchanged. */" : css;
  }

  // The site's own toggle writes `data-theme` too; follow it rather than getting out of step.
  const observer = view === null ? undefined : new view.MutationObserver(() => {
    render();
  });
  observer?.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  apply();
  render();

  return {
    css: () => cssFor(state),
    setPreset: (id: string) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (preset !== undefined) applyPreset(preset);
    },
    setToken,
    reset,
    destroy: () => {
      observer?.disconnect();
      sheet.remove();
      host.replaceChildren();
      host.classList.remove("pgl", "pgl--floating");
    },
  };
}
