/**
 * @vitest-environment jsdom
 *
 * Publishing carries the figures.
 *
 * Two things are stubbed, for two different reasons. `kineglyph` is stubbed because asserting on
 * the *bytes* of a real SVG would be a test of Kineglyph, not of this package — what belongs here
 * is that the right figure is resolved at the right width against the right theme tokens, and that
 * the result lands under `figures[id][theme]`. `evaluateSceneModule` is stubbed because a jsdom
 * document has neither `URL.createObjectURL` nor a loader that can import a `blob:` module; the
 * real one is exercised in the browser, and its contract here is only "text in, scene out".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleStore } from "../src/store/article-store.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import type { PublishPayload } from "../src/store/types.js";

const LIGHT = { name: "light-tokens" };
const DARK = { name: "dark-tokens" };

vi.mock("kineglyph", () => ({
  defaultTheme: { name: "default-tokens" },
  // The scene is carried through resolve → seek → render so the assertions can see which theme
  // and which width each SVG was produced with.
  resolveFigure: (figure: { id: string; broken?: boolean }, options: { width: number; theme: { name: string } }) => ({
    id: figure.id,
    width: options.width,
    theme: options.theme,
    timeline: { duration: 400 },
    diagnostics: figure.broken === true ? [{ severity: "error", code: "bad-scene", message: "no" }] : [],
  }),
  seekTimeline: (scene: Record<string, unknown>, time: number) => ({ ...scene, time }),
  renderSvg: (frame: { id: string; width: number; theme: { name: string }; time: number }, options: { idPrefix: string }) =>
    `<svg data-id="${frame.id}" data-width="${String(frame.width)}" data-theme="${frame.theme.name}" data-time="${String(frame.time)}" data-prefix="${options.idPrefix}"/>`,
  // The preview and node views reach for these; nothing here mounts anything.
  mountAll: async () => [],
  mountKineglyph: () => ({ destroy() {}, setTheme() {}, setScene() {} }),
  sceneFromSpec: (spec: unknown) => spec,
  validateSpec: () => ({ ok: true, errors: [] }),
}));

vi.mock("../src/ui/kineglyph.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ui/kineglyph.js")>();
  return {
    ...actual,
    // `export default { id: "x" }` without a module loader.
    evaluateSceneModule: async (source: string) => {
      const id = /id:\s*"([^"]+)"/.exec(source)?.[1];
      if (id === undefined) throw new Error("not a scene module");
      return { id, broken: source.includes("BROKEN") };
    },
    evaluateModule: async (source: string) =>
      source.includes("THEMES") ? { light: LIGHT, dark: DARK } : { default: {} },
  };
});

const { publishArticle } = await import("../src/ui/publish.js");

const ARTICLE = `slug: pub
title: Publishing
form: docs
status: published
nav:
  - { title: Home, page: index.md }
`;

const PAGE = `# Publishing

<figure class="kg" data-scene="scenes/one.mjs" id="one"></figure>

<figure class="kg" id="two"><script type="text/kineglyph">
export default { id: "inline-two" };
</script></figure>

<figure class="kg" data-static="/media/static.svg" id="three"></figure>
`;

const files = (extra: Record<string, string> = {}): Record<string, string> => ({
  "article.yaml": ARTICLE,
  "index.md": PAGE,
  "scenes/one.mjs": `export default { id: "scene-one" };\n`,
  ...extra,
});

async function storeOver(extra: Record<string, string> = {}): Promise<{ store: ArticleStore; backend: MemoryBackend }> {
  const backend = new MemoryBackend(files(extra));
  const store = new ArticleStore(backend);
  await store.load();
  return { store, backend };
}

describe("publishArticle", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("ships one SVG per theme per non-static figure", async () => {
    const { store, backend } = await storeOver();
    await publishArticle(store);

    const payload = backend.published as PublishPayload;
    expect(Object.keys(payload.figures).sort()).toEqual(["one", "two"]);
    // The static figure is already an asset; publish has nothing to add to it.
    expect(payload.figures["three"]).toBeUndefined();

    const one = payload.figures["one"]!;
    expect(Object.keys(one).sort()).toEqual(["dark", "light"]);
    expect(one["light"]).toContain(`data-id="scene-one"`);
    expect(one["light"]).toContain(`data-theme="default-tokens"`);
    expect(one["light"]).toContain(`data-prefix="one-light"`);
    expect(one["dark"]).toContain(`data-prefix="one-dark"`);
    // Every figure is rendered at its final frame, as the build's prerender does.
    expect(one["light"]).toContain(`data-time="400"`);
    expect(one["light"]).toContain(`data-width="960"`);

    // The inline figure's own module text, not the file's.
    expect(payload.figures["two"]!["light"]).toContain(`data-id="inline-two"`);

    // The rest of the payload is unchanged: manifest plus one HTML string per page.
    expect(payload.pages["/"]).toContain("Publishing");
    expect(payload.manifest.figures["one"]).toMatchObject({ kind: "module" });
  });

  it("uses the article's kineglyph width and theme module", async () => {
    const { store, backend } = await storeOver({
      "article.yaml": `${ARTICLE}kineglyph:\n  theme: themes/site.mjs\n  width: 720\n`,
      "themes/site.mjs": `// THEMES\nexport const light = {};\nexport const dark = {};\n`,
    });
    await publishArticle(store);

    const one = (backend.published as PublishPayload).figures["one"]!;
    expect(one["light"]).toContain(`data-width="720"`);
    expect(one["light"]).toContain(`data-theme="light-tokens"`);
    expect(one["dark"]).toContain(`data-theme="dark-tokens"`);
  });

  it("publishes the unsaved text of a scene, and drops a figure that will not render", async () => {
    const { store, backend } = await storeOver();
    await store.open("scenes/one.mjs");
    store.setText("scenes/one.mjs", `export default { id: "scene-one", BROKEN: true };\n`);
    await publishArticle(store);

    const payload = backend.published as PublishPayload;
    expect(payload.figures["one"]).toBeUndefined();
    // The other figure is still published: one broken diagram does not cost the author a publish.
    expect(payload.figures["two"]).toBeDefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("figure one"));
  });
});
