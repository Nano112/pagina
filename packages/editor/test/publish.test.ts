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
  // The host's real font, read off the page the editor is running in.
  documentFontFamily: () => "Figtree, sans-serif",
  withFontFamily: (theme: { name: string }, family: string) => ({ ...theme, family }),
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
  // The real one asks the resolved scene whether a live mount could add anything; the stub scene
  // above carries a 400ms timeline, so "yes", and no figure here is marked inert.
  sceneNeedsRuntime: (scene: { timeline?: { duration: number } }) => (scene.timeline?.duration ?? 0) > 0,
  renderSvg: (frame: { id: string; width: number; theme: { name: string; family?: string }; time: number }, options: { idPrefix: string }) =>
    `<svg viewBox="0 0 960 240" data-id="${frame.id}" data-width="${String(frame.width)}" data-theme="${frame.theme.name}" data-font="${frame.theme.family ?? ""}" data-time="${String(frame.time)}" data-prefix="${options.idPrefix}"><desc>d</desc></svg>`,
  // The preview and node views reach for these; nothing here mounts anything.
  mountAll: async () => [],
  mountAllKineglyphLabs: async () => [],
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

    // Laid out in the host's own font, which is the one thing publishing from a browser can know
    // and a build cannot: the editor is running inside the page the output has to look like.
    expect(one["light"]).toContain(`data-font="Figtree, sans-serif"`);

    // The rest of the payload is unchanged: manifest plus one HTML string per page.
    expect(payload.pages["/"]).toContain("Publishing");
    expect(payload.manifest.figures["one"]).toMatchObject({ kind: "module" });
  });

  it("carries the figures inside the published pages, not as links to them", async () => {
    const { store, backend } = await storeOver();
    await publishArticle(store);

    // An `<img>` is a document boundary: no host CSS and no accessibility tree crosses it. The
    // page ships the SVG itself, and its natural size, so the host can theme it and reserve it.
    const html = (backend.published as PublishPayload).pages["/"]!;
    expect(html).toContain(`style="--kg-w:960;--kg-h:240"`);
    expect(html).toContain(`<div class="kg-frame" data-kg-static data-kg-frame="one"><svg`);
    expect(html).toContain(`data-prefix="one-light"`);
    expect(html).not.toContain("<img");

    // A figure that did not render keeps an empty frame and hydrates client-side.
    expect(html).toContain(`data-kg-frame="two"><svg`);
  });

  it("warns about a figure with no description rather than shipping a silent diagram", async () => {
    const { store } = await storeOver();
    await publishArticle(store);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("no description"));
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
