/**
 * @vitest-environment jsdom
 *
 * `wireTabs` over the renderer's *own* output.
 *
 * The markup is produced by `@pagina/core` rather than written by hand, because the thing under
 * test is an agreement between two packages: core decides the roles, the ids and which panel is
 * `hidden`, and this moves them. A hand-written fixture would keep passing after core changed its
 * mind, which is precisely the drift that left the editor's preview with dead tabs while the
 * published page's worked.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMarkdown, renderMarkdown } from "@pagina/core";
import { wireTabs } from "../src/interactive.js";

const SOURCE = `=== "One"

    The first.

=== "Two"

    The second.
`;

let root: HTMLElement;

const tabs = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const panels = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')];

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  root.innerHTML = renderMarkdown(createMarkdown(), SOURCE).html;
  document.body.append(root);
});

describe("wireTabs", () => {
  it("selects the tab that was clicked, and shows only its panel", () => {
    wireTabs(root);
    expect(panels().map((p) => p.hidden)).toEqual([false, true]);

    tabs()[1]!.click();
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(panels().map((p) => p.hidden)).toEqual([true, false]);

    tabs()[0]!.click();
    expect(panels().map((p) => p.hidden)).toEqual([false, true]);
  });

  it("moves on the arrow keys and wraps, keeping one tab stop for the strip", () => {
    wireTabs(root);
    tabs()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0]);
    expect(document.activeElement).toBe(tabs()[1]);

    tabs()[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  });

  it("leaves focus alone when the caller asks it to", () => {
    wireTabs(root, { focusOnSelect: false });
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    tabs()[1]!.click();
    expect(panels().map((p) => p.hidden)).toEqual([true, false]);
    expect(document.activeElement).toBe(outside);
  });

  /**
   * The preview re-renders its HTML on a debounce and calls this again on the same DOM whenever
   * the markup happens to be unchanged. A second bind would toggle twice per click — which is to
   * say it would look like nothing happening at all.
   */
  it("is idempotent: wiring the same group twice does not double-bind it", () => {
    wireTabs(root);
    wireTabs(root);
    tabs()[1]!.click();
    expect(panels().map((p) => p.hidden)).toEqual([true, false]);
  });
});
