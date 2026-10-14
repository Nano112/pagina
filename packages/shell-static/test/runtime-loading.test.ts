/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ loads: 0, mountAll: vi.fn(async () => []), mountAllKineglyphLabs: vi.fn(async () => []) }));
vi.mock("kineglyph", () => {
  runtime.loads++;
  return { defaultTheme: {}, inheritTheme: () => ({}), themeByName: () => undefined,
    overrideTheme: (t: unknown) => t, registerTheme: vi.fn(),
    mountAll: runtime.mountAll, mountAllKineglyphLabs: runtime.mountAllKineglyphLabs };
});
beforeEach(() => {
  vi.resetModules();
  runtime.loads = 0;
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-kg-theme");
  document.documentElement.removeAttribute("data-kg-themes");
  document.body.innerHTML = '<button data-pagina-theme-toggle></button><article class="pg-content"><p>Text only</p></article>';
});
it("does not import the runtime on text-only pages, while the theme toggle still works", async () => {
  await import("../client/pagina.js");
  expect(runtime.loads).toBe(0);
  expect(runtime.mountAll).not.toHaveBeenCalled();
  document.documentElement.dataset.theme = "light";
  document.querySelector<HTMLButtonElement>("button")!.click();
  expect(document.documentElement.dataset.theme).toBe("dark");
});
it("keeps static-only SVG figures readable without importing the runtime", async () => {
  document.body.insertAdjacentHTML("beforeend", '<figure class="kg" data-static="/figure.svg"><svg><title>Static figure</title></svg></figure>');
  await import("../client/pagina.js");
  expect(runtime.loads).toBe(0);
  expect(document.querySelector("svg title")?.textContent).toBe("Static figure");
});
it.each(['<figure class="kg" data-scene="/scene.js"></figure>', '<div data-kineglyph="/scene.js"></div>', '<div data-kineglyph-lab></div>'])("loads the runtime for a figure or lab: %s", async (html) => {
  document.body.insertAdjacentHTML("beforeend", html);
  await import("../client/pagina.js");
  expect(runtime.mountAll).toHaveBeenCalled();
  expect(runtime.mountAllKineglyphLabs).toHaveBeenCalled();
});
