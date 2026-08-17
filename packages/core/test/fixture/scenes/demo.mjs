import { sceneFromSpec } from "kineglyph";

/**
 * The shape the Figure Builder emits — `sceneFromSpec` over a plain spec — so the fixture
 * exercises the path an author actually takes, and carries enough of one (tones, nested boxes,
 * edges, a description) that a figure rendered from it is worth looking at.
 */
export default sceneFromSpec({
  version: 1,
  id: "demo",
  title: "How a page is published",
  description:
    "Markdown is rendered to HTML, its figures are drawn against the host's own font, and both are stored together.",
  layout: "row",
  gap: 72,
  padding: 24,
  background: "canvas",
  nodes: [
    { kind: "box", id: "source", title: "Markdown", body: "prose and figures", tone: "neutral" },
    {
      kind: "box",
      id: "render",
      title: "Render",
      body: "measured once",
      tone: "accent",
      children: [{ kind: "caption", id: "font", text: "in the host's font", tone: "textMuted" }],
    },
    { kind: "box", id: "store", title: "Publish", body: "HTML plus figures", tone: "success" },
  ],
  edges: [
    { from: "source", to: "render", label: "parse", head: "arrow" },
    { from: "render", to: "store", label: "inline", style: "flow", head: "arrow" },
  ],
});
