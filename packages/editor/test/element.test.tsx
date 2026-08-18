/**
 * @vitest-environment jsdom
 *
 * `<pagina-editor>`: the surface a host application actually touches.
 *
 * Everything here is about attributes, because attributes are what a *template* produces, and a
 * template that has nothing to say produces `""` rather than omitting the attribute —
 * `page="{{ $page }}"` in Blade, `page={page}` in JSX. Reading that `""` as a value is how the
 * schemati integration ended up opening the path `""`, which the backend answered with its file
 * listing: the author got a JSON dump where their article should have been.
 *
 * `HttpBackend` is replaced with a `MemoryBackend`, so the element, `mountEditor` and `backendFor`
 * all run for real and only the socket is fake — the options handed to the constructor are then
 * exactly what the attributes turned into.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { settle } from "./settle.js";

const ARTICLE = `slug: fixture
title: Fixture Docs
form: docs
status: published
nav:
  - { title: Home, page: index.md }
`;

const state = vi.hoisted(() => ({
  files: {} as Record<string, string>,
  options: undefined as { baseUrl?: string; headers?: Record<string, string> } | undefined,
  reads: [] as string[],
}));

vi.mock("../src/store/http-backend.js", async () => {
  const { MemoryBackend } = await import("../src/store/memory-backend.js");
  return {
    HttpBackend: class {
      constructor(options: { baseUrl?: string }) {
        state.options = options;
        const backend = new MemoryBackend(state.files);
        const read = backend.read.bind(backend);
        backend.read = async (path: string) => {
          state.reads.push(path);
          return await read(path);
        };
        // A constructor may return another object; this is what makes the element reach it.
        return backend as unknown as never;
      }
    },
  };
});

vi.mock("kineglyph", () => ({
  mountAll: async () => [],
  mountAllKineglyphLabs: async () => [],
  mountKineglyph: () => ({ destroy() {}, setTheme() {}, setScene() {} }),
  defaultTheme: {},
}));

const { defineElement } = await import("../src/index.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  state.files = { "article.yaml": ARTICLE, "index.md": "# Home\n\nWelcome.\n", "guide/tabs.md": "# Tabs\n\nTabbed.\n" };
  state.options = undefined;
  state.reads = [];
  defineElement();
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  host.remove();
  await act(async () => {});
  vi.useRealTimers();
});

async function mount(attributes: Record<string, string>): Promise<HTMLElement> {
  const element = document.createElement("pagina-editor");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  await act(async () => {
    host.append(element);
  });
  await settle();
  return element;
}

describe("<pagina-editor> attributes", () => {
  it("treats an empty attribute as absent, so the documented defaults apply", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Exactly what the Laravel Blade view emits for an article opened at its root.
    await mount({ page: "", base: "", headers: "", "backend-url": "", "model-viewer-url": "" });

    // The path the editor opened: `index.md`, not `""` — which a backend answers with its listing.
    expect(state.reads).toContain("index.md");
    expect(state.reads).not.toContain("");
    expect(host.querySelector(".ProseMirror")?.textContent).toContain("Welcome");

    // An empty `backend-url` falls back to the documented default, not to `""`.
    expect(state.options?.baseUrl).toBe("/__pagina/edit");
    // `JSON.parse("")` throws; an absent value must never reach it.
    expect(state.options?.headers).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still honours every attribute that says something", async () => {
    await mount({
      page: "guide/tabs.md",
      "backend-url": "/api/articles/x",
      headers: `{"X-CSRF-TOKEN":"abc"}`,
    });

    expect(state.reads).toContain("guide/tabs.md");
    expect(host.querySelector(".ProseMirror")?.textContent).toContain("Tabbed");
    expect(state.options?.baseUrl).toBe("/api/articles/x");
    expect(state.options?.headers).toEqual({ "X-CSRF-TOKEN": "abc" });
  });
});
