/**
 * @vitest-environment jsdom
 *
 * "New page" writes two files, and the second one is `article.yaml`.
 *
 * The interesting part is not that the entry appears — it is that everything else in the file
 * survives. `article.yaml` is hand-written: parsing it to an object and re-serialising would strip
 * its comments and re-order its keys on the first click, which is the kind of damage an author
 * notices in a diff a week later and cannot undo. So the assertions here are mostly about what did
 * *not* change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { fireEvent } from "@testing-library/react";
import { mountEditor } from "../src/index.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { addNavEntry, navSections, removeNavEntry } from "../src/ui/nav-yaml.js";
import { settle } from "./settle.js";

vi.mock("kineglyph", () => ({ mountAll: async () => [], defaultTheme: {} }));

const ARTICLE = `slug: fixture
title: Fixture Docs
form: docs
status: published

# The reader's table of contents, in this order.
nav:
  - { title: Home, page: index.md }
  - section: Guide
    children:
      # The first thing anyone reads.
      - { title: Tabs, page: guide/tabs.md }
`;

describe("nav-yaml", () => {
  it("appends a top-level entry and keeps every comment", () => {
    const out = addNavEntry(ARTICLE, { title: "Changelog", page: "changelog.md" });
    expect(out).toContain("# The reader's table of contents, in this order.");
    expect(out).toContain("# The first thing anyone reads.");
    expect(out).toContain("{ title: Changelog, page: changelog.md }");
    // Order is the author's; a new page goes last, not wherever a re-serialise would put it.
    expect(out.indexOf("changelog.md")).toBeGreaterThan(out.indexOf("guide/tabs.md"));
    // Nothing above `nav` moved.
    expect(out.startsWith("slug: fixture\ntitle: Fixture Docs\nform: docs\nstatus: published\n")).toBe(true);
  });

  it("appends inside a named section", () => {
    const out = addNavEntry(ARTICLE, { title: "Figures", page: "guide/figures.md", section: "Guide" });
    const children = out.slice(out.indexOf("children:"));
    expect(children).toContain("guide/figures.md");
    expect(children.indexOf("guide/figures.md")).toBeGreaterThan(children.indexOf("guide/tabs.md"));
  });

  it("falls back to the top level for a section that does not exist", () => {
    const out = addNavEntry(ARTICLE, { title: "Stray", page: "stray.md", section: "Nope" });
    // Indentation is the proof: two spaces is a nav child, six is a section's child.
    expect(out).toMatch(/\n {2}- \{ title: Stray, page: stray\.md \}/);
  });

  it("is idempotent for a page that is already in the nav", () => {
    expect(addNavEntry(ARTICLE, { title: "Tabs again", page: "guide/tabs.md" })).toBe(ARTICLE);
  });

  it("creates the nav when the file has none", () => {
    const out = addNavEntry("slug: x\ntitle: X\n", { title: "Home", page: "index.md" });
    expect(out).toContain("nav:");
    expect(out).toContain("index.md");
  });

  it("removes a nested entry but leaves the section standing", () => {
    const out = removeNavEntry(ARTICLE, "guide/tabs.md");
    expect(out).not.toContain("guide/tabs.md");
    expect(out).toContain("section: Guide");
    expect(out).toContain("# The reader's table of contents, in this order.");
    expect(removeNavEntry(ARTICLE, "not-there.md")).toBe(ARTICLE);
  });

  it("lists the sections a new page may join", () => {
    expect(navSections(ARTICLE)).toEqual(["Guide"]);
    expect(navSections("slug: x\ntitle: X\n")).toEqual([]);
  });
});

describe("the sidebar's New page", () => {
  let host: HTMLElement;
  let backend: MemoryBackend;
  let handle: ReturnType<typeof mountEditor>;

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
  const GEOMETRY = {
    getClientRects: { value: () => [], configurable: true },
    getBoundingClientRect: { value: () => ZERO_RECT, configurable: true },
  };
  Object.defineProperties(Text.prototype, GEOMETRY);
  Object.defineProperties(Range.prototype, GEOMETRY);

  beforeEach(async () => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    backend = new MemoryBackend({
      "article.yaml": ARTICLE,
      "index.md": "# Home\n",
      "guide/tabs.md": "# Tabs\n",
    });
    await act(async () => {
      handle = mountEditor(host, { backend, page: "index.md" });
    });
    await settle();
  });

  afterEach(async () => {
    handle.destroy();
    await act(async () => {});
    host.remove();
    vi.useRealTimers();
  });

  it("creates the file, adds the nav entry, and refreshes the tree", async () => {
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("New page"));
    expect(button).toBeDefined();
    await act(async () => {
      fireEvent.click(button!);
    });

    const form = host.querySelector<HTMLFormElement>(".pge-newpage");
    expect(form).not.toBeNull();
    const title = form!.querySelectorAll("input")[0]!;
    await act(async () => {
      fireEvent.change(title, { target: { value: "Release notes" } });
    });
    // The file name follows the title until it is touched.
    expect(form!.querySelectorAll("input")[1]!.value).toBe("release-notes.md");

    const section = form!.querySelector("select")!;
    await act(async () => {
      fireEvent.change(section, { target: { value: "Guide" } });
    });
    await act(async () => {
      fireEvent.submit(form!);
    });
    await settle();

    expect(handle.store.files.get("release-notes.md")?.text).toBe("# Release notes\n\n");

    const yaml = handle.store.files.get("article.yaml")?.text ?? "";
    expect(yaml).toContain("{ title: Release notes, page: release-notes.md }");
    expect(yaml).toContain("# The reader's table of contents, in this order.");
    expect(yaml.slice(yaml.indexOf("children:"))).toContain("release-notes.md");

    // The store re-parsed the config, so the tree shows the page without a reload.
    expect(handle.store.navPages().map((p) => p.page)).toContain("release-notes.md");
    expect(host.querySelector(".pge-tree")?.textContent).toContain("Release notes");
    // And it reached the backend.
    expect((await backend.read("article.yaml")).text).toContain("release-notes.md");
  });

  it("takes the nav entry with the page when it is deleted", async () => {
    const toggle = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("All files"));
    await act(async () => {
      fireEvent.click(toggle!);
    });
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Delete guide/tabs.md"]');
    expect(remove).not.toBeNull();

    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    await act(async () => {
      fireEvent.click(remove!);
    });
    await settle();

    expect(handle.store.files.has("guide/tabs.md")).toBe(false);
    expect(handle.store.files.get("article.yaml")?.text ?? "").not.toContain("guide/tabs.md");
    expect(handle.store.navPages().map((p) => p.page)).not.toContain("guide/tabs.md");
  });
});
