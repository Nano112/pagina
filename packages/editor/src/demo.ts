/**
 * The editor against browser storage, as a page can load it: `dist/demo.js`.
 *
 * This is the whole of pagina's live demo — the one on the docs page and the full-screen one — and
 * it lives here rather than in a `<script type="module">` inside `docs/demo.md` for the reason that
 * inline script was flagged: it was the only executable thing in the repository that eslint,
 * `tsc` and the test suites all skipped. Two pages now share one implementation, and it is checked
 * like everything else.
 *
 * ## Why it loads `editor.js` through a URL instead of importing it
 *
 * `dist/editor.js` is a 1.3 MB bundle and this file is a few kilobytes. A static import would fuse
 * them, so a reader who scrolls past the demo would download a WYSIWYG editor to read the
 * documentation. The dynamic `import()` of a URL built from `import.meta.url` keeps the bundle a
 * separate request, made when the demo is actually wanted, and keeps this module emitted by plain
 * `tsc` — no second bundler entry, no shared chunk, and `dist/editor.js` stays the single
 * self-contained file every host depends on it being.
 *
 * `import.meta.url` is this file's own URL, so every asset is found relative to it: the editor and
 * its stylesheet are siblings, and the site's base is the directory above. That holds whether the
 * site sits at a domain root or under a sub-path, which is exactly what a GitHub Pages deployment
 * needs and what an absolute path would get wrong.
 */

/** The editor's public surface, without importing a byte of it at build time. */
type EditorModule = typeof import("./index.js");

/** The sample article. Seeding only writes files that are *missing*, so a reload keeps your work. */
export const DEMO_SEED: Readonly<Record<string, string>> = {
  "article.yaml": [
    "slug: demo",
    "title: A sample article",
    "form: docs",
    "status: published",
    "description: Three pages that live in your browser and nowhere else.",
    "",
    "nav:",
    "  - { title: Start here, page: index.md }",
    "  - { title: Things to try, page: guide/try.md }",
    "",
  ].join("\n"),
  "index.md": [
    "# A sample article",
    "",
    "This file is markdown, and the editor above is editing **the markdown itself** — there is no",
    "intermediate format. Whatever you build here is what a text editor would show you.",
    "",
    '!!! note "This is an admonition"',
    "    Click into it and type. It goes back to disk as three lines beginning !!! note.",
    "",
    "The pane on the right is the real renderer, not an approximation of it.",
    "",
  ].join("\n"),
  "guide/try.md": [
    "# Things to try",
    "",
    "1. Type a heading, then press / on an empty line to open the insert menu.",
    "2. Insert an admonition, a tabbed block, or a table.",
    "3. Press Publish: the article is rendered here in your browser and you land in the reading view.",
    "4. Reload the page. Everything is still here.",
    "5. Open this page in a second tab, edit the same file in both, and watch the conflict banner.",
    "",
    "## A tabbed block",
    "",
    '=== "One"',
    "",
    "    The first tab.",
    "",
    '=== "Two"',
    "",
    "    The second. The tabs work in the preview pane too, and each tab carries its own delete",
    "    control.",
    "",
  ].join("\n"),
};

export interface DemoOptions {
  /**
   * `"inline"` — an embedded frame that waits to be asked before it downloads 1.3 MB.
   * `"fullscreen"` — the whole viewport, loaded at once, because that is what the reader came for.
   */
  readonly chrome?: "inline" | "fullscreen";
  /** Folder-relative page to open. */
  readonly page?: string;
  /** localStorage namespace. Shared by both chromes on purpose: it is one article, seen two ways. */
  readonly namespace?: string;
  /**
   * Who this tab writes as. Omitted, the backend's honest default ("This browser") is used.
   *
   * The demo reads it from `?as=` so two tabs on one browser store can be two people — which is
   * the only way a reader can *see* the conflict banner name somebody rather than take it on
   * trust. It is a demo affordance and it is worth being clear about what it is not: nothing
   * authenticates it, because there is no server here to authenticate against. A real host does
   * not let the page choose; it derives the author from the session it already has.
   */
  readonly author?: { id: string; name: string };
  /** Where "back" goes from the full-screen editor. Omitted, the link is not rendered. */
  readonly backHref?: string;
  readonly backLabel?: string;
}

const NAMESPACE = "pagina-docs-demo";
/** Storage usage is read on a timer because a write can come from any of a dozen places. */
const USAGE_POLL_MS = 2000;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * Mounts the demo into `host`, building every element it needs.
 *
 * The host page contributes an empty container and nothing else — no ids to keep in step, no
 * duplicated markup between the two pages that use this.
 */
export function startDemo(host: HTMLElement, options: DemoOptions = {}): void {
  const chrome = options.chrome ?? "inline";
  injectStyles();
  host.classList.add("pgd", `pgd--${chrome}`);
  host.replaceChildren();

  if (chrome === "fullscreen") {
    void load(host, options);
    return;
  }

  // Inline: a placeholder that says what the cost is, and two ways to accept it.
  const placeholder = el("div", "pgd__placeholder");
  const heading = el("strong", "pgd__heading", "The editor is about 1.3 MB");
  const blurb = el(
    "span",
    "pgd__blurb",
    "It is not loaded with the rest of this page, so nobody downloads a WYSIWYG editor to read the documentation. It starts on its own when you scroll it into view, or now:",
  );
  const button = el("button", "pgd__button", "Load the editor");
  button.type = "button";
  const status = el("span", "pgd__status");
  placeholder.append(heading, blurb, button, status);
  host.append(placeholder);

  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    status.textContent = "Loading the editor…";
    void load(host, options, status).catch(() => {
      started = false;
    });
  };

  button.addEventListener("click", start);
  if ("IntersectionObserver" in window) {
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          watcher.disconnect();
          start();
        }
      },
      { rootMargin: "150px" },
    );
    watcher.observe(host);
  }
}

/**
 * The demo's own chrome, in the demo's own file.
 *
 * Deliberately not in `theme.css`: that sheet is `dist/editor.css`, which every host that embeds
 * the editor links, and a demo frame's placeholder is not something a host should have to carry or
 * override. Every value is a `--pg-*` token for the same reason the editor's sheet is — this runs
 * inside pagina's docs today and could run inside anything tomorrow.
 */
const DEMO_CSS = `
.pgd { display: grid; color: var(--pg-fg); }
.pgd--inline {
  block-size: 660px;
  border: 1px solid var(--pg-line);
  border-radius: var(--pg-radius);
  overflow: hidden;
  background: var(--pg-bg-raised);
  margin-block: 1.5rem;
}
.pgd--fullscreen { block-size: 100dvh; }
.pgd__placeholder {
  block-size: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.75rem; padding: 2rem; text-align: center;
}
.pgd__heading { font-family: var(--pg-font-display); }
.pgd__blurb { color: var(--pg-muted); max-inline-size: 46ch; }
.pgd__button, .pgd__reset {
  font: inherit; cursor: pointer;
  border: 1px solid var(--pg-line-strong); border-radius: var(--pg-radius);
  background: var(--pg-bg); color: var(--pg-fg);
}
.pgd__button { padding: 0.5rem 1rem; }
.pgd__reset { padding: 0.2rem 0.7rem; font-size: 0.85em; }
.pgd__status { color: var(--pg-muted); font-size: 0.85rem; min-block-size: 1.2em; }
.pgd:has(.pgd__mount) { grid-template-rows: auto minmax(0, 1fr); }
.pgd__bar {
  display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
  padding: 0.35rem 0.75rem; font-size: 0.85rem; color: var(--pg-muted);
  border-block-end: 1px solid var(--pg-line); background: var(--pg-bg-raised);
}
.pgd__back { color: var(--pg-accent); font-weight: 600; text-decoration: none; }
.pgd__mount { min-block-size: 0; }
.pgd__open { font-weight: 600; }
.pgd__open-note { color: var(--pg-muted); }
`;

/** The demo's chrome, injected once — before the placeholder, which wears it. */
function injectStyles(): void {
  if (document.querySelector("style[data-pagina-demo]") !== null) return;
  const style = document.createElement("style");
  style.dataset["paginaDemo"] = "";
  style.textContent = DEMO_CSS;
  document.head.appendChild(style);
}

/** The editor's stylesheet, linked once per page however many demos are on it. */
function linkStylesheet(): void {
  const href = new URL("editor.css", import.meta.url).href;
  if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`) !== null) return;
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  // Assigned rather than written as an attribute in markup: `rewriteLinks` in `@pagina/core`
  // rewrites every relative `href` in a page to point at the article's own assets, which is right
  // for a page and wrong for a file the article does not contain.
  sheet.href = href;
  document.head.appendChild(sheet);
}

async function load(host: HTMLElement, options: DemoOptions, status?: HTMLElement): Promise<void> {
  const say = (text: string): void => {
    if (status !== undefined) status.textContent = text;
    else host.replaceChildren(el("p", "pgd__status", text));
  };
  try {
    linkStylesheet();
    const editor = (await import(/* @vite-ignore */ new URL("editor.js", import.meta.url).href)) as EditorModule;

    if (!editor.hasLocalStorage()) {
      say(
        "This browser will not let this page store anything — private browsing, or site data is blocked for this site. The editor has nowhere to save, so the demo stops here rather than losing what you type.",
      );
      return;
    }

    const backend = new editor.LocalStorageBackend({
      namespace: options.namespace ?? NAMESPACE,
      seed: DEMO_SEED,
      ...(options.author === undefined ? {} : { author: options.author }),
    });

    host.replaceChildren();
    const bar = el("div", "pgd__bar");
    const mount = el("div", "pgd__mount");
    host.append(bar, mount);

    if (options.backHref !== undefined) {
      const back = el("a", "pgd__back", options.backLabel ?? "Back");
      back.href = options.backHref;
      bar.append(back);
    }

    const reset = el("button", "pgd__reset", "Reset the demo article");
    reset.type = "button";
    const usage = el("span", "pgd__usage");
    bar.append(reset, usage);

    editor.mountEditor(mount, {
      backend,
      page: options.page ?? "index.md",
      base: new URL("../", import.meta.url).pathname,
    });

    const showUsage = (): void => {
      const used = backend.usage();
      usage.textContent = `${String(used.files)} files, ${(used.bytes / 1024).toFixed(1)} KB in this browser`;
    };
    showUsage();
    setInterval(showUsage, USAGE_POLL_MS);

    reset.addEventListener("click", () => {
      if (!window.confirm("Throw away every change and put the sample article back?")) return;
      void backend.reset().then(() => window.location.reload());
    });
  } catch (error) {
    say(`The editor did not load: ${error instanceof Error ? error.message : String(error)}`);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
