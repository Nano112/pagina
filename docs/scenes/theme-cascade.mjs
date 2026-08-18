import { sceneFromSpec } from "kineglyph";

/**
 * The cascade, drawn as what it is: one thing said five times, at five ranges.
 *
 * `theming.md` is organised around this. A table can list the levels, but it cannot show the two
 * properties that make them a cascade rather than five features — that each one writes the *same*
 * tokens, and that a level which says nothing is not a gap but an inheritance. The descending
 * sequence carries the first; the edge labels carry the second.
 *
 * The accent is on the level most sites actually write (the host); everything else is neutral,
 * because no level here is a fallback or a last resort — each is simply the range at which
 * somebody had something to say.
 */
export default sceneFromSpec({
  version: 1,
  id: "theme-cascade",
  title: "One theme, inherited",
  description:
    "Five levels — pagina's default, the host, the article, the page, the figure. Each writes the same --pg-* tokens, each is optional, and each one that says nothing inherits the one above it.",
  layout: "stack",
  gap: 24,
  padding: 24,
  background: "canvas",
  nodes: [
    {
      kind: "box",
      id: "default",
      title: "1 — pagina's default",
      body: "tokens.css defines every --pg-*",
      tone: "neutral",
      children: [{ kind: "caption", id: "c1", text: "the answer when nothing else says otherwise", tone: "textMuted" }],
    },
    {
      kind: "box",
      id: "host",
      title: "2 — the host",
      body: "a stylesheet mapping --pg-* onto your design system",
      tone: "accent",
      children: [{ kind: "caption", id: "c2", text: "every page pagina renders inside that host", tone: "textMuted" }],
    },
    {
      kind: "box",
      id: "article",
      title: "3 — the article",
      body: "article.yaml — theme: a CSS file of its own",
      tone: "neutral",
      children: [{ kind: "caption", id: "c3", text: "every page of that article", tone: "textMuted" }],
    },
    {
      kind: "box",
      id: "page",
      title: "4 — the page",
      body: "front matter — theme: over the article's",
      tone: "neutral",
      children: [{ kind: "caption", id: "c4", text: "that page alone", tone: "textMuted" }],
    },
    {
      kind: "box",
      id: "figure",
      title: "5 — the figure",
      body: "a Kineglyph theme, claiming the roles it names",
      tone: "neutral",
      children: [{ kind: "caption", id: "c5", text: "that figure alone; the roles it does not name still follow the page", tone: "textMuted" }],
    },
  ],
  edges: [
    { from: "default", to: "host", label: "silent? inherit", head: "arrow" },
    { from: "host", to: "article", label: "silent? inherit", head: "arrow" },
    { from: "article", to: "page", label: "silent? inherit", head: "arrow" },
    { from: "page", to: "figure", label: "silent? inherit", style: "flow", head: "arrow" },
  ],
});
