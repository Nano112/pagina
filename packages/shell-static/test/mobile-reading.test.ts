import { expect, it } from "vitest";
import { read, stripComments } from "./css-layers.js";

it("shows native navigation at the rail breakpoint", () => {
  const css = stripComments(read("../client/pagina.css"));
  expect(css).toMatch(/\.pg-mobile-nav\s*\{[^}]*display:\s*none/);
  expect(css).toMatch(/@media\s*\(max-width:\s*960px\)\s*\{[^}]*\.pg-mobile-nav\s*\{[^}]*display:\s*block/);
});

it("wraps inline prose tokens without changing preformatted code scrolling", () => {
  const css = stripComments(read("../client/reading.css"));
  expect(css).toMatch(/\.pg-content\s*\{[^}]*overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/\.pg-content pre\s*\{[^}]*overflow-wrap:\s*normal/);
  expect(css).toMatch(/\.pg-content pre\s*\{[^}]*overflow:\s*auto/);
});
