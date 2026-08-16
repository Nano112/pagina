/**
 * @vitest-environment jsdom
 *
 * The figure builder, from both ends: the file format it writes (which must survive being read back
 * by the *next* editing session) and the form itself (which must refuse to write a spec Kineglyph
 * would reject, and say why next to the field).
 *
 * `sceneFromSpec`/`validateSpec` are pure and are exactly what is under test here, so — unlike the
 * other suites — this one keeps the real ones (`importActual` through the config's `kineglyph`
 * alias) and stubs only `mountKineglyph`/`mountAll`, which want a laid-out document jsdom does not
 * have. Validating against a hand-copied rule set instead would test the copy, not the runtime.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SimpleSceneSpec } from "kineglyph";
import { mountEditor } from "../src/index.js";
import { ArticleStore } from "../src/store/index.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { FigureBuilder } from "../src/ui/FigureBuilder.js";
import { parseSpecFromModule, specToModuleSource, SPEC_MARKER } from "../src/ui/kineglyph.js";
import { relativePath, resolvePath, slugify } from "../src/ui/paths.js";

vi.mock("kineglyph", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("kineglyph")),
  mountKineglyph: () => ({ destroy() {}, setTheme() {}, setScene() {} }),
  mountAll: async () => [],
}));

const SPEC: SimpleSceneSpec = {
  version: 1,
  id: "pipeline",
  title: "The pipeline",
  description: "Two boxes and an arrow",
  layout: "row",
  gap: 24,
  padding: 32,
  background: "surface",
  nodes: [
    { id: "src", kind: "box", title: "Source", body: "markdown", tone: "accent", layout: "stack", children: [{ id: "note", kind: "caption", text: "one file" }] },
    { id: "out", kind: "box", title: "Output", body: "html" },
  ],
  edges: [{ from: "src", to: "out", label: "render", style: "flow", head: "arrow" }],
  timeline: "reveal",
};

afterEach(cleanup);

describe("spec ⇄ module source", () => {
  it("round-trips a spec through the module it writes", () => {
    const source = specToModuleSource(SPEC);
    expect(source).toContain(SPEC_MARKER);
    expect(source).toContain('import { sceneFromSpec } from "kineglyph"');
    expect(parseSpecFromModule(source)).toEqual(SPEC);
  });

  it("refuses a module that was not written from a spec", () => {
    const handWritten = `import { defineScene, stack } from "kineglyph";\nexport default defineScene({ schemaVersion: 2, id: "x", root: stack("r", []) });\n`;
    expect(parseSpecFromModule(handWritten)).toBeNull();
    // The marker alone is not enough: the JSON still has to be a valid spec.
    expect(parseSpecFromModule(`${SPEC_MARKER}\nexport default sceneFromSpec({ "version": 2 });\n`)).toBeNull();
  });

  it("survives reformatting, because it counts braces rather than matching a shape", () => {
    const source = specToModuleSource(SPEC).replace(/\n/g, "\n\n").replace("export default", "export  default");
    expect(parseSpecFromModule(source)).toEqual(SPEC);
  });

  /**
   * The brace counter walks the source character by character, so the characters that *look* like
   * structure are the ones that can break it: a `}` inside a string, an escaped quote, a newline in
   * a label. All three are things an author types into a figure without thinking about it.
   */
  it("round-trips text carrying quotes, braces and newlines", () => {
    const awkward: SimpleSceneSpec = {
      version: 1,
      id: "awkward",
      title: 'A "quoted" {title}',
      description: "line one\nline two\twith a tab",
      layout: "stack",
      nodes: [
        { id: "a", kind: "text", text: 'he said "}" and then \\ left' },
        { id: "b", kind: "code", text: 'const x = { "k": "v" };\nreturn x;' },
      ],
      edges: [{ from: "a", to: "b", label: 'why "not"' }],
    };
    const source = specToModuleSource(awkward);
    expect(parseSpecFromModule(source)).toEqual(awkward);
  });
});

describe("paths", () => {
  it("spells a scene the way the page containing it has to", () => {
    expect(relativePath("guide/figures.md", "scenes/demo.mjs")).toBe("../scenes/demo.mjs");
    expect(relativePath("index.md", "scenes/demo.mjs")).toBe("scenes/demo.mjs");
    expect(resolvePath("guide/figures.md", "../scenes/demo.mjs")).toBe("scenes/demo.mjs");
    expect(resolvePath("index.md", "https://example.com/a.mjs")).toBe("https://example.com/a.mjs");
  });

  it("slugs a title into the character set a spec id allows", () => {
    expect(slugify("The Pipeline!")).toBe("the-pipeline");
    expect(slugify("Café notes")).toBe("cafe-notes");
    expect(slugify("///")).toBe("figure");
  });
});

describe("<FigureBuilder>", () => {
  const store = (): ArticleStore => new ArticleStore(new MemoryBackend({ "article.yaml": "slug: x\ntitle: X\n" }));

  it("names the field a problem belongs to instead of failing at save time", () => {
    render(
      <FigureBuilder
        store={store()}
        request={{ spec: { version: 1, id: "demo", title: "", layout: "stack", nodes: [] }, onSave: () => {} }}
        onClose={() => {}}
      />,
    );
    const problems = document.querySelector(".pge-builder__problems");
    expect(problems?.textContent).toContain("title");
    expect(problems?.textContent).toContain("must not be empty");
    // …and the same message is repeated on the field itself, which is where an author looks.
    expect(document.querySelector(".pge-field__error")?.textContent).toBe("must not be empty");
    expect((screen.getByRole("button", { name: "Save figure" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("writes scenes/<id>.mjs and hands the caller the path it wrote", async () => {
    const articles = store();
    const saved: { path?: string; spec?: SimpleSceneSpec } = {};
    render(
      <FigureBuilder
        store={articles}
        request={{
          spec: SPEC,
          onSave: (path, spec) => {
            saved.path = path;
            saved.spec = spec;
          },
        }}
        onClose={() => {}}
      />,
    );
    expect(document.querySelector(".pge-builder__problems")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save figure" }));
    await vi.waitFor(() => expect(saved.path).toBe("scenes/pipeline.mjs"));

    const written = articles.files.get("scenes/pipeline.mjs")?.text ?? "";
    expect(written).toContain(SPEC_MARKER);
    // The file the builder wrote is a file the builder can re-open. That is the whole contract.
    expect(parseSpecFromModule(written)).toEqual(SPEC);
    expect(saved.spec).toEqual(SPEC);
  });

  /** A store that has actually listed its folder, which is what a collision check reads. */
  const loaded = async (files: Record<string, string>): Promise<ArticleStore> => {
    const articles = new ArticleStore(new MemoryBackend({ "article.yaml": "slug: x\ntitle: X\n", ...files }));
    await articles.load();
    return articles;
  };

  const idField = (): HTMLInputElement =>
    screen.getByLabelText(/^Id/, { selector: "input" }) as HTMLInputElement;
  const saveButton = (): HTMLButtonElement => screen.getByRole("button", { name: "Save figure" }) as HTMLButtonElement;

  /**
   * The id is a file name and the author can type anything into it, so a *new* figure whose id
   * happens to name an existing scene would replace that scene's source without a word — including
   * a scene nobody has opened this session, which is exactly the one that would go unnoticed.
   */
  it("refuses to write a new figure over a scene that already exists", async () => {
    const articles = await loaded({ "scenes/pipeline.mjs": "// someone else's figure\nexport default {};\n" });
    const saved: string[] = [];
    render(
      <FigureBuilder store={articles} request={{ spec: SPEC, onSave: (path) => saved.push(path) }} onClose={() => {}} />,
    );

    expect(saveButton().disabled).toBe(true);
    expect(document.querySelector(".pge-field__error")?.textContent).toBe("A scene with this id already exists");
    fireEvent.click(saveButton());
    expect(saved).toHaveLength(0);
    expect(articles.files.get("scenes/pipeline.mjs")?.text).toBeUndefined();

    // A different id is a different file, and the objection goes away with it.
    fireEvent.change(idField(), { target: { value: "pipeline-2" } });
    expect(saveButton().disabled).toBe(false);
    expect(document.querySelector(".pge-field__error")).toBeNull();
  });

  it("still overwrites the scene it was opened on, which is what saving means", async () => {
    const articles = await loaded({ "scenes/pipeline.mjs": "// someone else's figure\nexport default {};\n" });
    const saved: string[] = [];
    render(
      <FigureBuilder
        store={articles}
        request={{ spec: SPEC, scenePath: "scenes/pipeline.mjs", onSave: (path) => saved.push(path) }}
        onClose={() => {}}
      />,
    );

    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await vi.waitFor(() => expect(saved).toEqual(["scenes/pipeline.mjs"]));
    expect(articles.files.get("scenes/pipeline.mjs")?.text).toContain(SPEC_MARKER);
  });

  it("derives the id from the title until the author says otherwise", () => {
    render(<FigureBuilder store={store()} request={{ onSave: () => {} }} onClose={() => {}} />);
    // The labels carry their field's error message too, so match on the prefix.
    const field = (name: string): HTMLInputElement =>
      screen.getByLabelText(new RegExp(`^${name}`), { selector: "input" }) as HTMLInputElement;
    fireEvent.change(field("Title"), { target: { value: "Render pipeline" } });
    expect(field("Id").value).toBe("render-pipeline");

    fireEvent.change(field("Id"), { target: { value: "custom" } });
    fireEvent.change(field("Title"), { target: { value: "Something else" } });
    expect(field("Id").value).toBe("custom");
  });

  it("adds and removes nodes, keeping ids unique", () => {
    render(<FigureBuilder store={store()} request={{ onSave: () => {} }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Add node/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add node/ }));
    const ids = [...document.querySelectorAll<HTMLInputElement>(".pge-input--id")].map((input) => input.value);
    expect(new Set(ids).size).toBe(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove node" })[0]!);
    expect(document.querySelectorAll(".pge-input--id")).toHaveLength(1);
  });
});

/**
 * The node view's *offer*, which is the decision that matters: the builder may only re-open a
 * module it wrote. A hand-authored scene gets the source editor instead, because a form cannot
 * express what `defineScene` can and re-opening one in the builder would quietly flatten it.
 */
describe("the figureKg node view", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
  const GEOMETRY = {
    getClientRects: { value: () => [], configurable: true },
    getBoundingClientRect: { value: () => ZERO_RECT, configurable: true },
  };
  Object.defineProperties(Text.prototype, GEOMETRY);
  Object.defineProperties(Range.prototype, GEOMETRY);

  const ARTICLE = `slug: fixture\ntitle: Fixture\nform: docs\nstatus: published\nnav:\n  - { title: Figures, page: guide/figures.md }\n`;
  const PAGE = `# Figures\n\n<figure class="kg" data-scene="../scenes/demo.mjs"></figure>\n`;
  const HAND_WRITTEN = `import { defineScene, stack, heading } from "kineglyph";\nexport default defineScene({ schemaVersion: 2, id: "demo", root: stack("r", [heading("h", "Demo")]) });\n`;

  const mount = async (scene: string): Promise<{ host: HTMLElement; handle: ReturnType<typeof mountEditor> }> => {
    const host = document.createElement("div");
    document.body.append(host);
    const backend = new MemoryBackend({ "article.yaml": ARTICLE, "guide/figures.md": PAGE, "scenes/demo.mjs": scene });
    let handle!: ReturnType<typeof mountEditor>;
    await act(async () => {
      handle = mountEditor(host, { backend, page: "guide/figures.md" });
    });
    // Real timers here: the pane's 400 ms debounce is irrelevant, but the store's `open(scene)` is
    // a promise chain several ticks deep and the node view only offers the builder once it lands.
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    return { host, handle };
  };

  it("offers the builder for a module it wrote, and only the source editor otherwise", async () => {
    const labelsOf = (host: HTMLElement): string[] =>
      [...host.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());

    const generated = await mount(specToModuleSource(SPEC));
    expect(labelsOf(generated.host)).toContain("Open in builder");
    generated.handle.destroy();
    await act(async () => {});
    generated.host.remove();

    const handAuthored = await mount(HAND_WRITTEN);
    const labels = labelsOf(handAuthored.host);
    expect(labels).not.toContain("Open in builder");
    expect(labels).toContain("Edit source");
    handAuthored.handle.destroy();
    await act(async () => {});
    handAuthored.host.remove();
  });
});
