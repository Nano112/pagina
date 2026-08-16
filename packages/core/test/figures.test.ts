import { describe, expect, it } from "vitest";
import { extractFigures } from "../src/figures.js";
const opts = { pageSlug: "guide-figures", themes: ["light", "dark"], staticBaseUrl: (id: string) => `/_pagina/figures/guide-figures/${id}` };
describe("extractFigures", () => {
  it("classifies inline, module and static figures and injects a picture fallback", () => {
    const html = `<figure class="kg" data-scene="/scenes/demo.mjs"></figure>
<figure class="kg" id="inline-demo"><script type="text/kineglyph">export default 1</script></figure>
<figure class="kg" data-static="/media/s.svg"><img src="/media/s.svg" alt="static"></figure>`;
    const r = extractFigures(html, opts);
    expect(r.figures).toEqual([
      { id: "kg-guide-figures-1", kind: "module", scene: "/scenes/demo.mjs" },
      { id: "inline-demo", kind: "inline", source: "export default 1" },
      { id: "kg-guide-figures-3", kind: "static", static: "/media/s.svg" },
    ]);
    expect(r.html).toContain(`<figure class="kg" data-scene="/scenes/demo.mjs" id="kg-guide-figures-1"><picture class="kg-static"><source media="(prefers-color-scheme: dark)" srcset="/_pagina/figures/guide-figures/kg-guide-figures-1.dark.svg"><img src="/_pagina/figures/guide-figures/kg-guide-figures-1.light.svg" alt="" loading="lazy"></picture></figure>`);
    expect(r.html).toContain(`<script type="text/kineglyph">export default 1</script>`); // inline kept for the runtime
    expect(r.html).toContain(`<img src="/media/s.svg" alt="static">`);           // static untouched
  });
});
