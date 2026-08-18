/**
 * The search dialog.
 *
 * This module is **never** in the page's first load. `client/pagina.ts` binds the keys and the
 * trigger button and does nothing else; the first time a reader actually asks for search, it
 * `import()`s this file, which then fetches the index. A reader who never searches pays for one
 * `keydown` listener, and the index — the largest thing search costs — is not requested at all.
 *
 * Everything drawn here is a `--pg-*` token away from a host's own theme: there is not one literal
 * colour in `search.css`. The markup is built in script rather than shipped in every page's HTML
 * because a dialog no one has opened is bytes on every page for a feature used on one of them.
 *
 * **It degrades by saying so.** With scripting off, the trigger the shell rendered stays `disabled`
 * and titled with the reason. If the index fails to fetch — offline, a stale cache against a
 * redeployed site, a host that never wrote the file — the dialog opens onto an error with a retry,
 * not an input that silently answers nothing.
 */
// The subpath, not the barrel. `@pagina/core` re-exports the markdown renderer, the YAML parser
// and the bundle codec; importing search through it put all of them in this chunk — 192 kB of
// build-time machinery in a dialog, for one 4 kB module. `search.ts` imports nothing but types.
import { parseSearchIndex, searchIndex, type SearchHit, type SearchIndex, type SnippetPart } from "@pagina/core/search";

/** ids the dialog owns. Fixed, because `aria-controls`/`aria-activedescendant` are id references. */
const RESULTS_ID = "pg-search-results";
const LABEL_ID = "pg-search-label";
const OPTION_ID = (i: number) => `pg-search-option-${String(i)}`;

/** What the page told us. Both are written by the shell's template onto `<html>`. */
interface Wiring {
  /** URL of the index JSON. */
  readonly url: string;
  /** The site base, which the index's hrefs do not carry, so one index works under any base. */
  readonly base: string;
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly index: SearchIndex };

let state: State = { kind: "loading" };
let pending: Promise<void> | undefined;
let ui: Ui | undefined;

/** Focusable things inside the dialog, for the trap. Results are reached with the arrows. */
const FOCUSABLE = 'input, button:not([disabled]), [href][tabindex]:not([tabindex="-1"])';

interface Ui {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
  readonly list: HTMLUListElement;
  readonly status: HTMLParagraphElement;
  readonly count: HTMLSpanElement;
  hits: SearchHit[];
  active: number;
  /** What had focus when the dialog opened, so closing can give it back. */
  restore: Element | null;
}

// --- loading -----------------------------------------------------------------------------------

function loadIndex(url: string): Promise<void> {
  // A failed load clears this, so the retry button is a real retry and not a replayed rejection.
  pending ??= (async () => {
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`the index answered ${String(res.status)}`);
      state = { kind: "ready", index: parseSearchIndex(await res.text()) };
    } catch (error) {
      pending = undefined;
      state = { kind: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  })();
  return pending;
}

// --- rendering ---------------------------------------------------------------------------------

/** Marked runs as elements. `textContent` throughout: a snippet is text, and never markup. */
function parts(into: HTMLElement, runs: readonly SnippetPart[]): void {
  for (const run of runs) {
    if (run.mark) {
      const mark = document.createElement("mark");
      mark.textContent = run.text;
      into.append(mark);
    } else {
      into.append(document.createTextNode(run.text));
    }
  }
}

function hitHref(base: string, hit: SearchHit): string {
  const b = base.replace(/\/$/, "");
  return `${b}${hit.href}${hit.anchor === undefined ? "" : `#${hit.anchor}`}`;
}

function render(u: Ui, wiring: Wiring): void {
  u.list.replaceChildren();
  const query = u.input.value.trim();

  if (state.kind === "loading") return say(u, "Loading the search index…", false);
  if (state.kind === "failed") {
    say(u, `Search is unavailable: ${state.message}.`, true);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "pg-search__retry";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      state = { kind: "loading" };
      render(u, wiring);
      void loadIndex(wiring.url).then(() => { render(u, wiring); });
    });
    u.status.append(" ", retry);
    return;
  }
  if (query === "") {
    u.hits = [];
    u.active = -1;
    setCount(u, "");
    return say(u, `Search ${state.index.title}. Type a word from a heading, a paragraph, or a diagram.`, false);
  }

  u.hits = searchIndex(state.index, query);
  u.active = u.hits.length === 0 ? -1 : 0;
  if (u.hits.length === 0) {
    setCount(u, "No results");
    return say(u, `Nothing matches “${query}”.`, false);
  }
  u.status.hidden = true;
  u.hits.forEach((hit, i) => {
    const li = document.createElement("li");
    li.className = "pg-search__hit";
    li.id = OPTION_ID(i);
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === 0));

    const a = document.createElement("a");
    a.className = "pg-search__link";
    a.href = hitHref(wiring.base, hit);
    // Not in the tab order: the arrows move through results, and Tab is the trap's business.
    a.tabIndex = -1;

    const kicker = document.createElement("span");
    kicker.className = "pg-search__kicker";
    kicker.textContent = hit.anchor === undefined ? hit.page : `${hit.page} › ${hit.title}`;

    const title = document.createElement("span");
    title.className = "pg-search__title";
    parts(title, hit.titleParts);

    const snippet = document.createElement("span");
    snippet.className = "pg-search__snippet";
    if (hit.fromFigure) {
      const tag = document.createElement("span");
      tag.className = "pg-search__tag";
      tag.textContent = "diagram";
      snippet.append(tag, " ");
    }
    parts(snippet, hit.snippet);

    a.append(kicker, title, snippet);
    li.append(a);
    li.addEventListener("mousemove", () => { setActive(u, i); });
    u.list.append(li);
  });
  setCount(u, `${String(u.hits.length)} result${u.hits.length === 1 ? "" : "s"}`);
  u.input.setAttribute("aria-activedescendant", OPTION_ID(0));
}

function say(u: Ui, message: string, isError: boolean): void {
  u.status.hidden = false;
  u.status.classList.toggle("pg-search__state--error", isError);
  u.status.textContent = message;
  u.input.removeAttribute("aria-activedescendant");
}

/** The live region. Separate from the visible state line so it announces counts and nothing else. */
function setCount(u: Ui, text: string): void {
  u.count.textContent = text;
}

function setActive(u: Ui, i: number): void {
  if (u.hits.length === 0) return;
  const next = (i + u.hits.length) % u.hits.length;
  u.active = next;
  [...u.list.children].forEach((li, j) => { li.setAttribute("aria-selected", String(j === next)); });
  u.input.setAttribute("aria-activedescendant", OPTION_ID(next));
  u.list.children[next]?.scrollIntoView({ block: "nearest" });
}

// --- the dialog ---------------------------------------------------------------------------------

function build(wiring: Wiring): Ui {
  const root = document.createElement("div");
  root.className = "pg-search";
  root.hidden = true;

  const dialog = document.createElement("div");
  dialog.className = "pg-search__dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", LABEL_ID);

  const label = document.createElement("h2");
  label.id = LABEL_ID;
  label.className = "pg-search__label";
  label.textContent = "Search";

  const bar = document.createElement("div");
  bar.className = "pg-search__bar";

  const input = document.createElement("input");
  input.className = "pg-search__input";
  input.type = "text";                       // not `search`: the UA's own clear button is chrome
  input.placeholder = "Search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", RESULTS_ID);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-label", "Search this article");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "pg-search__close";
  close.setAttribute("aria-label", "Close search");
  close.textContent = "Esc";

  const list = document.createElement("ul");
  list.id = RESULTS_ID;
  list.className = "pg-search__results";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Search results");

  const status = document.createElement("p");
  status.className = "pg-search__state";

  const foot = document.createElement("div");
  foot.className = "pg-search__foot";
  const keys = document.createElement("span");
  keys.className = "pg-search__keys";
  for (const [key, what] of [["↑↓", "navigate"], ["↵", "open"], ["esc", "close"]]) {
    const kbd = document.createElement("kbd");
    kbd.textContent = key!;
    const span = document.createElement("span");
    span.append(kbd, ` ${what!}`);
    keys.append(span);
  }
  const count = document.createElement("span");
  count.className = "pg-search__count";
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");

  foot.append(keys, count);
  bar.append(input, close);
  dialog.append(label, bar, list, status, foot);
  root.append(dialog);
  document.body.append(root);

  const u: Ui = { root, input, list, status, count, hits: [], active: -1, restore: null };

  root.addEventListener("mousedown", (event) => {
    // The backdrop, not the dialog: a click that starts inside and drags out is not a dismissal.
    if (event.target === root) dismiss(u);
  });
  close.addEventListener("click", () => { dismiss(u); });
  input.addEventListener("input", () => { render(u, wiring); });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss(u);
      return;
    }
    if (event.key === "Tab") {
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const on = document.activeElement;
      if (event.shiftKey ? on === first : on === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
      return;
    }
    if (u.hits.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(u, u.active + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(u, event.key === "Home" ? 0 : u.hits.length - 1);
      return;
    }
    if (event.key === "Enter") {
      const link = u.list.children[u.active]?.querySelector("a");
      if (link === null || link === undefined) return;
      event.preventDefault();
      // A modified Enter means the reader wants a tab, and the browser knows how to do that.
      if (event.metaKey || event.ctrlKey) window.open(link.href, "_blank", "noopener");
      else {
        dismiss(u);
        window.location.assign(link.href);
      }
    }
  });
  // A same-page result is a fragment navigation, which fires no load: close on the way out or the
  // dialog stays open over the section it just jumped to.
  list.addEventListener("click", () => { dismiss(u); });
  return u;
}

/**
 * Closes the dialog and puts focus back where it came from.
 *
 * The `blur()` is not tidiness. Hiding a subtree does not synchronously move focus out of it in
 * every browser, and `document.body.focus()` — which is what "give it back" means when the dialog
 * was opened with a keystroke rather than from a button — is a no-op on an element that is not
 * focusable. Leave it out and the input inside the now-hidden dialog keeps focus, the next `/`
 * lands on an `<input>`, the "don't hijack a slash someone is typing" rule fires, and search
 * silently stops reopening. That is exactly what happened, and it is what `search.spec.ts`'s
 * open-close-open sequence exists to catch.
 */
function dismiss(u: Ui): void {
  if (u.root.hidden) return;
  const restore = u.restore;
  u.restore = null;
  u.root.hidden = true;
  document.documentElement.classList.remove("pg-search-open");
  u.input.blur();
  if (restore instanceof HTMLElement && restore.isConnected && restore !== document.body) restore.focus();
}

/**
 * Opens the dialog, building it on first use and starting the index fetch alongside.
 *
 * `initial` seeds the box — the `/` shortcut passes nothing, but a host wiring its own button to a
 * query string can.
 */
export function openSearch(wiring: Wiring, initial = ""): void {
  ui ??= build(wiring);
  const u = ui;
  u.restore = document.activeElement;
  u.root.hidden = false;
  // The page behind must not scroll under an overlay that owns the viewport on a phone.
  document.documentElement.classList.add("pg-search-open");
  if (initial !== "") u.input.value = initial;
  render(u, wiring);
  u.input.focus();
  u.input.select();
  if (state.kind === "loading") void loadIndex(wiring.url).then(() => { if (!u.root.hidden) render(u, wiring); });
}
