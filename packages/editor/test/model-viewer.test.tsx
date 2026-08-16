/**
 * @vitest-environment jsdom
 *
 * The `<model-viewer>` node: the markup it serialises to (which is copied verbatim into the page,
 * so it has to be exactly right), the module the editor loads to render one, and the node view's
 * upload, which has to write the `src` *relative to the page* — the one thing about this node that
 * is easy to get subtly wrong and never notice until the model 404s on a nested page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { fireEvent } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { mountEditor } from "../src/index.js";
import { ArticleStore } from "../src/store/index.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { parseMarkdown } from "../src/model/parser.js";
import { serializeMarkdown } from "../src/model/serializer.js";
import { loadModelViewer } from "../src/ui/nodes/ModelViewerView.js";
import { uploadAndInsert } from "../src/ui/uploads.js";
import { settle } from "./settle.js";
import { DEFAULT_MODEL_VIEWER_URL } from "../src/ui/context.js";

vi.mock("kineglyph", () => ({ mountAll: async () => [], defaultTheme: {} }));

const PAGE = `# Models

<model-viewer src="../media/robot.glb" alt="A robot" camera-controls="" auto-rotate=""></model-viewer>
`;

const ARTICLE = `slug: fixture
title: Fixture Docs
form: docs
status: published
nav:
  - { title: Home, page: index.md }
  - { title: Models, page: guide/models.md }
`;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
const GEOMETRY = {
  getClientRects: { value: () => [], configurable: true },
  getBoundingClientRect: { value: () => ZERO_RECT, configurable: true },
};
Object.defineProperties(Text.prototype, GEOMETRY);
Object.defineProperties(Range.prototype, GEOMETRY);

describe("the modelViewer node", () => {
  it("serialises to the element the page will contain, attributes and all", () => {
    const doc = parseMarkdown(PAGE).doc;
    const out = serializeMarkdown(doc);
    expect(out).toContain(
      '<model-viewer src="../media/robot.glb" alt="A robot" camera-controls="" auto-rotate=""></model-viewer>',
    );
    // A fixed point: saving twice must not change the bytes.
    expect(serializeMarkdown(parseMarkdown(out).doc)).toBe(out);
  });

  it("keeps attributes it does not model", () => {
    const source = `<model-viewer src="a.glb" ar="" poster="p.webp" shadow-intensity="1"></model-viewer>\n`;
    expect(serializeMarkdown(parseMarkdown(source).doc)).toContain('shadow-intensity="1"');
  });
});

describe("loadModelViewer", () => {
  afterEach(() => {
    document.querySelectorAll("script[data-pge-model-viewer]").forEach((script) => script.remove());
  });

  it("adds the module once, however many nodes ask for it", () => {
    const doc = document.implementation.createHTMLDocument("t");
    loadModelViewer(DEFAULT_MODEL_VIEWER_URL, doc);
    loadModelViewer(DEFAULT_MODEL_VIEWER_URL, doc);
    const scripts = doc.querySelectorAll("script[data-pge-model-viewer]");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute("src")).toBe(DEFAULT_MODEL_VIEWER_URL);
    expect(scripts[0]?.getAttribute("type")).toBe("module");
  });

  it("honours a host that self-hosts the element", () => {
    const doc = document.implementation.createHTMLDocument("t");
    loadModelViewer("/vendor/model-viewer.js", doc);
    expect(doc.querySelector("script[data-pge-model-viewer]")?.getAttribute("src")).toBe("/vendor/model-viewer.js");
  });
});

describe("the modelViewer node view", () => {
  let host: HTMLElement;
  let backend: MemoryBackend;
  let handle: ReturnType<typeof mountEditor>;

  beforeEach(async () => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    backend = new MemoryBackend({ "article.yaml": ARTICLE, "index.md": "# Home\n", "guide/models.md": PAGE });
    await act(async () => {
      handle = mountEditor(host, { backend, page: "guide/models.md", modelViewerUrl: "/vendor/mv.js" });
    });
    await settle();
  });

  afterEach(async () => {
    handle.destroy();
    await act(async () => {});
    host.remove();
    document.querySelectorAll("script[data-pge-model-viewer]").forEach((script) => script.remove());
    vi.useRealTimers();
  });

  it("renders the real element and loads the configured module", () => {
    const card = host.querySelector(".pge-model");
    expect(card).not.toBeNull();
    const element = card?.querySelector("model-viewer");
    expect(element?.getAttribute("src")).toBe("../media/robot.glb");
    expect(element?.getAttribute("camera-controls")).toBe("");
    expect(document.querySelector("script[data-pge-model-viewer]")?.getAttribute("src")).toBe("/vendor/mv.js");
  });

  it("toggles a flag attribute through the node's `attrs` JSON", async () => {
    const ar = [...host.querySelectorAll<HTMLInputElement>(".pge-model input[type=checkbox]")].at(-1);
    expect(ar).toBeDefined();
    await act(async () => {
      fireEvent.click(ar!);
    });
    await settle();
    expect(handle.store.files.get("guide/models.md")?.text ?? "").toContain('ar=""');
  });

  it("writes an uploaded GLB's path relative to the page", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "robot2.glb", { type: "model/gltf-binary" });
    const input = host.querySelector<HTMLInputElement>('.pge-model input[type="file"]');
    expect(input).not.toBeNull();
    Object.defineProperty(input!, "files", { value: [file], configurable: true });

    await act(async () => {
      fireEvent.change(input!);
    });
    await settle();

    // The backend stored `media/robot2.glb`; the page is `guide/models.md`, so it must be written
    // as `../media/robot2.glb` — the same href the published page resolves.
    expect(handle.store.files.get("guide/models.md")?.text ?? "").toContain('src="../media/robot2.glb"');
  });
});

/**
 * What an uploaded file becomes.
 *
 * Decided on the *stored* path, not on `File.type`, which is empty for a great many real files —
 * and it is the same decision for the toolbar, a drop and a paste, which is why it lives in one
 * function. The editor is a stub here on purpose: what is under test is the choice and the href it
 * is given, not TipTap's ability to insert a node.
 */
describe("uploadAndInsert", () => {
  const stubEditor = (): { editor: Editor; inserted: unknown[] } => {
    const inserted: unknown[] = [];
    const chain = {
      insertContent: (content: unknown) => {
        inserted.push(content);
        return chain;
      },
      run: () => true,
    };
    const editor = { chain: () => ({ focus: () => chain }) } as unknown as Editor;
    return { editor, inserted };
  };

  const store = (): ArticleStore =>
    new ArticleStore(new MemoryBackend({ "article.yaml": ARTICLE, "guide/models.md": "# Models\n" }));

  const upload = async (name: string, type: string): Promise<unknown> => {
    const { editor, inserted } = stubEditor();
    await uploadAndInsert(editor, store(), new File([new Uint8Array([1])], name, { type }), "guide/models.md");
    return inserted[0];
  };

  it("makes an image node of an image", async () => {
    expect(await upload("shot.png", "image/png")).toEqual({
      type: "image",
      attrs: { src: "../media/shot.png", alt: "shot.png" },
    });
  });

  it("makes a model node of a .glb, even when the browser reports no MIME type", async () => {
    expect(await upload("robot.glb", "")).toEqual({
      type: "modelViewer",
      attrs: { src: "../media/robot.glb", alt: "robot.glb" },
    });
  });

  it("makes a link of anything else — the only honest thing a page can do with it", async () => {
    expect(await upload("notes.pdf", "application/pdf")).toBe("[notes.pdf](../media/notes.pdf)");
  });
});
