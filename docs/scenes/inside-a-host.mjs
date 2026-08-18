import { sceneFromSpec } from "kineglyph";

/**
 * What crosses the boundary between a host application and an article rendered inside it.
 *
 * The index's claim is that most documentation tools assume they own the page, and that pagina is
 * built for the case where they do not. A screenshot cannot show that, because the interesting
 * part is what is *absent*: no theme to configure, no shell to fight, no second design system
 * arriving with the docs. What is present is a list of custom properties, and this draws them as
 * the only thing travelling in either direction.
 *
 * The middle box is deliberately the narrow one. `theming.md` documents the cascade at length; the
 * shape of it is that a host writes tokens, pagina reads them, and nothing else is exchanged.
 */
export default sceneFromSpec({
  version: 1,
  id: "inside-a-host",
  title: "An article inside somebody else's page",
  description:
    "A host application supplies the header, the palette and the layout. It defines about twenty --pg-* custom properties. pagina renders the article's markup and figures against those, and contributes nothing else to the page.",
  layout: "row",
  gap: 56,
  padding: 24,
  background: "canvas",
  nodes: [
    {
      kind: "box",
      id: "host",
      title: "the host application",
      body: "its header, its routes, its design system",
      tone: "accent",
      children: [
        { kind: "caption", id: "owns", text: "owns the page it puts the docs on", tone: "textMuted" },
      ],
    },
    {
      kind: "box",
      id: "tokens",
      title: "--pg-*",
      body: "22 custom properties, plus 3 per admonition kind",
      tone: "neutral",
      children: [
        { kind: "caption", id: "only", text: "the whole of the contract", tone: "textMuted" },
      ],
    },
    {
      kind: "box",
      id: "article",
      title: "the article",
      body: "semantic markup, layered CSS, inline-SVG figures",
      tone: "success",
      children: [
        { kind: "caption", id: "layer", text: "unlayered host rules win without !important", tone: "textMuted" },
        { kind: "caption", id: "figs", text: "diagrams read the same tokens the prose does", tone: "textMuted" },
      ],
    },
  ],
  edges: [
    { from: "host", to: "tokens", label: "defines", head: "arrow" },
    { from: "tokens", to: "article", label: "paints", style: "flow", head: "arrow" },
  ],
});
