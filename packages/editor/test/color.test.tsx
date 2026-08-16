/**
 * @vitest-environment jsdom
 *
 * The colour picker. Two things are worth pinning: that a swatch reports a `#rrggbb` string
 * whatever form the token was written in (`getComputedStyle` hands back `rgb(…)`, and a mark
 * carrying `rgb(…)` serialises differently from the same colour as hex), and that the palette is
 * read from the document rather than hard-coded.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ColorButton, ColorPicker, expandHex, paletteFrom, toHex } from "../src/ui/ColorPicker.js";

vi.mock("kineglyph", () => ({ mountAll: async () => [], defaultTheme: {} }));

afterEach(cleanup);

describe("colour conversion", () => {
  it("normalises every form a token can arrive in", () => {
    expect(toHex("rgb(17, 34, 51)")).toBe("#112233");
    expect(toHex("rgba(255, 0, 0, 0.5)")).toBe("#ff0000");
    expect(toHex("  #ABC ")).toBe("#aabbcc");
    expect(toHex("#3B82F6")).toBe("#3b82f6");
    // Not a colour this picker can offer as a swatch: it says so rather than guessing.
    expect(toHex("color-mix(in srgb, red, blue)")).toBeUndefined();
    expect(toHex("")).toBeUndefined();
    expect(expandHex("#abc")).toBe("#aabbcc");
  });
});

describe("<ColorPicker>", () => {
  it("emits hex when a swatch is clicked", () => {
    const picked: string[] = [];
    render(<ColorPicker value="#112233" onPick={(hex) => picked.push(hex)} />);
    const swatch = document.querySelectorAll<HTMLButtonElement>(".pge-color__swatch")[0];
    expect(swatch).toBeDefined();
    fireEvent.click(swatch!);
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("emits hex from the text field, expanding a three-digit value", () => {
    const picked: string[] = [];
    render(<ColorPicker onPick={(hex) => picked.push(hex)} />);
    const field = screen.getByLabelText("Colour, hex");
    fireEvent.change(field, { target: { value: "#0f0" } });
    fireEvent.blur(field);
    expect(picked).toEqual(["#00ff00"]);
  });

  it("ignores a half-typed value instead of emitting nonsense", () => {
    const picked: string[] = [];
    render(<ColorPicker onPick={(hex) => picked.push(hex)} />);
    const field = screen.getByLabelText("Colour, hex");
    fireEvent.change(field, { target: { value: "#12" } });
    fireEvent.blur(field);
    expect(picked).toEqual([]);
  });

  it("offers a 'no colour' swatch only when clearing is possible", () => {
    const { unmount } = render(<ColorPicker onPick={() => {}} />);
    expect(document.querySelector(".pge-color__swatch--none")).toBeNull();
    unmount();

    const cleared: number[] = [];
    render(<ColorPicker onPick={() => {}} onClear={() => cleared.push(1)} />);
    fireEvent.click(screen.getByLabelText("No colour"));
    expect(cleared).toEqual([1]);
  });

  it("reads its palette from the document's own custom properties", () => {
    const host = document.createElement("div");
    host.style.setProperty("--pg-accent", "rgb(59, 130, 246)");
    host.style.setProperty("--pg-danger", "#d64545");
    document.body.append(host);
    const palette = paletteFrom(host);
    expect(palette.map((entry) => entry.hex)).toContain("#3b82f6");
    expect(palette.map((entry) => entry.hex)).toContain("#d64545");
    host.remove();
  });
});

describe("<ColorButton>", () => {
  it("opens on click, emits, and closes again", () => {
    const picked: string[] = [];
    render(
      <ColorButton title="Highlight" onPick={(hex) => picked.push(hex)}>
        H
      </ColorButton>,
    );
    const button = screen.getByRole("button", { name: "Highlight" });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".pge-color__swatch")[0]!);
    expect(picked).toHaveLength(1);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});
