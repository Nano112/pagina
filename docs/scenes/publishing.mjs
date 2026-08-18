import { sceneFromSpec } from "kineglyph";

/**
 * The publish path: one folder, three destinations, and the fact that they are all the same render.
 *
 * The thing worth drawing here is not the sequence — a list would carry that — but the *fork*.
 * `build`, `pack` and the editor's preview are three different words in the CLI, and a reader's
 * reasonable first assumption is that they are three different pipelines that might disagree.
 * They are not: the render happens once, and the three outputs are that same render written down
 * three ways. That is why a bundle a host serves without running Node is byte-for-byte what a
 * build here would have produced, and it is the claim `bundles.md` rests on.
 */
export default sceneFromSpec({
  version: 1,
  id: "publishing",
  title: "How an article is published",
  description:
    "An article folder is rendered once. That single render is written out as a static site, as a portable bundle, or into a host page — which is why the three cannot disagree.",
  layout: "row",
  gap: 64,
  padding: 24,
  background: "canvas",
  nodes: [
    {
      kind: "box",
      id: "folder",
      title: "article folder",
      body: "article.yaml, markdown, scenes, media",
      tone: "neutral",
      children: [{ kind: "caption", id: "nav", text: "nav decides what is a page", tone: "textMuted" }],
    },
    {
      kind: "box",
      id: "render",
      title: "one render",
      body: "markdown → HTML, figures drawn, links checked",
      tone: "accent",
      children: [{ kind: "caption", id: "strict", text: "a broken reference stops it", tone: "textMuted" }],
    },
    {
      kind: "box",
      id: "out",
      title: "the same bytes, three ways",
      tone: "success",
      children: [
        { kind: "caption", id: "site", text: "build → a static site", tone: "textMuted" },
        { kind: "caption", id: "bundle", text: "pack → one .pgz file", tone: "textMuted" },
        { kind: "caption", id: "host", text: "embed → a host's page", tone: "textMuted" },
      ],
    },
  ],
  edges: [
    { from: "folder", to: "render", label: "read", head: "arrow" },
    { from: "render", to: "out", label: "write", style: "flow", head: "arrow" },
  ],
});
