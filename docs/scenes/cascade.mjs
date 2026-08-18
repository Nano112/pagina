import { sceneFromSpec } from "kineglyph";

/**
 * The four escape hatches, drawn as what they actually are: a ladder, not a menu.
 *
 * `theming.md` lists them in order and says to stop at the first one that works. A table cannot
 * show *why* the order is the order — that each rung down the list gives the host more control and
 * pagina less, and that the last rung gives up pagina's styling entirely. Drawing them as a
 * descending sequence with the trade named on each edge is the part the prose was carrying badly.
 *
 * The tones are load-bearing: the first rung is the one to reach for (accent), the middle two are
 * ordinary (neutral), and the last is the one you should have a reason for (warning).
 */
export default sceneFromSpec({
  version: 1,
  id: "cascade",
  title: "The four escape hatches, in order",
  description:
    "Map the tokens; if that is not enough, override rules; then drop pagina's reading styles; and only then turn its CSS off entirely. Each step hands the host more control and pagina less.",
  layout: "stack",
  gap: 28,
  padding: 24,
  background: "canvas",
  nodes: [
    {
      kind: "box",
      id: "tokens",
      title: "1 — map the tokens",
      body: "point ~20 --pg-* at your design system",
      tone: "accent",
      children: [{ kind: "caption", id: "t1", text: "no rules written, nothing to re-check on upgrade", tone: "textMuted" }],
    },
    {
      kind: "box",
      id: "rules",
      title: "2 — override rules",
      body: "plain unlayered CSS beats every pagina layer",
      tone: "neutral",
      children: [{ kind: "caption", id: "t2", text: "no !important needed", tone: "textMuted" }],
    },
    {
      kind: "box",
      id: "tokensonly",
      title: "3 — theme: tokens",
      body: "keep structure and tokens, style the column yourself",
      tone: "neutral",
    },
    {
      kind: "box",
      id: "none",
      title: "4 — theme: none",
      body: "pagina ships no CSS at all",
      tone: "warning",
      children: [{ kind: "caption", id: "t4", text: "you own every surface, including the editor's", tone: "textMuted" }],
    },
  ],
  edges: [
    { from: "tokens", to: "rules", label: "not enough?", head: "arrow" },
    { from: "rules", to: "tokensonly", label: "still fighting it?", head: "arrow" },
    { from: "tokensonly", to: "none", label: "want none of it?", style: "flow", head: "arrow" },
  ],
});
