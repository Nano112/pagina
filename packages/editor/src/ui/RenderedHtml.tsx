/**
 * A block of `@pagina/core` HTML, put into the page the way the published site puts it there.
 *
 * Two surfaces need this and they used to share nothing: the preview pane, and the published view
 * an author lands on after pressing *Publish*. Both render the real renderer's output in the
 * browser; both therefore need the two things the site's `<article>` gets from its client bundle
 * and a bare `innerHTML` does not — Kineglyph figures hydrated on the *article's* theme, and tab
 * groups that respond to a click.
 *
 * The tab half is the one that was missing. `@pagina/core` emits a tablist whose panels are
 * `hidden`; moving that flag is `@pagina/shell-static`'s `wireTabs`, which the published page runs
 * and the preview never did — so in the preview the second tab could not be selected. It is called
 * on every paint of new HTML and is idempotent, because this component re-renders on a debounce
 * while the author types.
 */
import { useEffect, useRef, type ReactNode } from "react";
// Must stay a bare specifier: the host page's import map (and `@pagina/vite`'s dev alias) points it
// at the one runtime instance the site itself uses, and the editor bundle keeps it external.
import { mountAll, mountAllKineglyphLabs, type EmbeddedFigure, type KineglyphLabController } from "kineglyph";
import { wireTabs } from "@pagina/shell-static/interactive";
import { applyThemeVars, currentThemeName, loadKineglyphThemes, onThemeChange, type KineglyphThemes } from "./kineglyph-theme.js";

export interface RenderedHtmlProps {
  readonly html: string;
  /**
   * The article's Kineglyph theme module, as a URL. Without it the runtime paints every figure in
   * its own default palette, so an author edits a blue diagram and publishes a teal one.
   */
  readonly themeUrl?: string | undefined;
  readonly className?: string;
}

export function RenderedHtml({ html, themeUrl, className = "pg-content" }: RenderedHtmlProps): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  const figures = useRef<EmbeddedFigure[]>([]);
  const labs = useRef<KineglyphLabController[]>([]);
  const themes = useRef<KineglyphThemes | undefined>(undefined);
  const themeSource = useRef<string | undefined>(undefined);

  // Hydration runs after every paint of new HTML. The previous controllers own DOM that React has
  // just replaced, so they are destroyed first — otherwise each render leaks a running figure.
  useEffect(() => {
    const container = root.current;
    if (container === null) return;
    for (const figure of figures.current) figure.controller.destroy();
    figures.current = [];
    for (const lab of labs.current) lab.destroy();
    labs.current = [];
    // Before the await, so the tabs work even if the Kineglyph runtime is missing or throws — the
    // same order, and the same reason, as the site's own client entry.
    wireTabs(container);
    let cancelled = false;
    void (async () => {
      // Loaded once per theme URL and kept, so a keystroke does not re-import the module; the
      // `theme` callback itself stays live, so the light/dark toggle still repaints.
      if (themes.current === undefined || themeSource.current !== themeUrl) {
        themes.current = await loadKineglyphThemes(themeUrl);
        themeSource.current = themeUrl;
      }
      const resolved = themes.current;
      applyThemeVars(container, themeUrl === undefined ? undefined : resolved);
      const mountedFigures = await mountAll({
        root: container,
        selector: "figure.kg:not([data-kineglyph-lab]), [data-kineglyph]:not([data-kineglyph-lab])",
        theme: () => resolved[currentThemeName()],
      });
      const mountedLabs = await mountAllKineglyphLabs({
        root: container, theme: () => resolved[currentThemeName()], controls: "auto", readout: "auto", machineControls: "auto",
      });
      return { mountedFigures, mountedLabs };
    })()
      .then(({ mountedFigures, mountedLabs }) => {
        if (cancelled) {
          for (const figure of mountedFigures) figure.controller.destroy();
          for (const lab of mountedLabs) lab.destroy();
        } else {
          figures.current = mountedFigures;
          labs.current = mountedLabs;
        }
      })
      .catch((e: unknown) => {
        console.warn("pagina: rendered figures failed to mount", e);
      });
    return () => {
      cancelled = true;
    };
  }, [html, themeUrl]);

  // The light/dark toggle moves the whole page; these figures have to move with it, and the
  // variables that paint them are set by hand rather than by a stylesheet, so nothing else would.
  useEffect(
    () =>
      onThemeChange(() => {
        if (root.current !== null && themeSource.current !== undefined) applyThemeVars(root.current, themes.current);
        const theme = themes.current?.[currentThemeName()];
        if (theme !== undefined) for (const lab of labs.current) lab.setTheme(theme);
      }),
    [],
  );

  useEffect(
    () => () => {
      for (const figure of figures.current) figure.controller.destroy();
      figures.current = [];
      for (const lab of labs.current) lab.destroy();
      labs.current = [];
    },
    [],
  );

  return <div className={className} ref={root} dangerouslySetInnerHTML={{ __html: html }} />;
}
