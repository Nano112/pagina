/**
 * The behaviour that rendered pagina HTML needs in order to *work*, rather than merely look right.
 *
 * `@pagina/core` renders a tab group as a `role="tablist"` of buttons over `role="tabpanel"`
 * sections, all but the first `hidden`. That markup is inert on its own: something has to move the
 * `hidden` flag when a tab is clicked. On the published site that something is
 * `client/pagina.ts` — but the site's client bundle is not the only place core's HTML is put into a
 * DOM. The editor's preview pane renders the same HTML with the same renderer in the browser, and
 * so does the published view an author lands on after pressing *Publish*; neither loads the site's
 * client bundle, so in both of them the tabs were dead — the first panel showed and the second tab
 * could not be selected. That was reported as an editor bug and was really this: one behaviour with
 * one implementation and three callers, of which only one had it.
 *
 * So it lives here, in the package that owns the reading surface, takes a root rather than
 * assuming `document`, and is idempotent — the preview re-renders its HTML on a debounce, and
 * wiring a group twice must not install two listeners.
 */

/** Marks a group as wired, so re-running over the same DOM is a no-op rather than a double bind. */
const WIRED = "pgTabsWired";

export interface WireTabsOptions {
  /**
   * Whether selecting a tab moves focus to it.
   *
   * True on a page, where the strip is a roving tabindex and the author reached it with the
   * keyboard. False where the click may have come from somewhere that must keep the focus it has.
   */
  readonly focusOnSelect?: boolean;
}

/**
 * Makes every `[data-pg-tabs]` group under `root` interactive: click, ←/→, and a roving tabindex.
 *
 * Selection follows focus, which is right for panels whose content is already in the document —
 * there is nothing to load, so a separate activation step would only be an extra keystroke.
 */
export function wireTabs(root: ParentNode, options: WireTabsOptions = {}): void {
  const focusOnSelect = options.focusOnSelect ?? true;
  for (const group of root.querySelectorAll<HTMLElement>("[data-pg-tabs]")) {
    if (group.dataset[WIRED] === "") continue;
    group.dataset[WIRED] = "";
    const tabs = [...group.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const select = (i: number, focus: boolean): void => {
      tabs.forEach((tab, j) => {
        const on = i === j;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
        const panel = ownerDocument(group).getElementById(tab.getAttribute("aria-controls") ?? "");
        if (panel !== null) panel.hidden = !on;
        if (on && focus) tab.focus({ preventScroll: true });
      });
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(i, focusOnSelect));
      tab.addEventListener("keydown", (event) => {
        const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : undefined;
        if (delta === undefined) return;
        event.preventDefault();
        select((i + delta + tabs.length) % tabs.length, true);
      });
    });
  }
}

/**
 * The document the group belongs to.
 *
 * `getElementById` is a document method and the panels are addressed by id, so a group rendered
 * into some other document — a preview built in a detached tree, a test's jsdom — has to be looked
 * up in *its* document rather than in the ambient one.
 */
function ownerDocument(node: Element): Document {
  return node.ownerDocument;
}
