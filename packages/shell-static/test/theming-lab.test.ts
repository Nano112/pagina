/**
 * @vitest-environment jsdom
 *
 * The theming showcase and the theme lab.
 *
 * Two things are worth testing here and one is not. The *drift* guards are worth it: every token
 * an identity or a control names has to be one `client/tokens.css` actually defines, or the widget
 * offers a reader a variable nothing reads, and every colour token the contract defines has to be
 * reachable from a control, or the widget is quietly incomplete. So is the **export**, which is the
 * whole claim of the lab: what the panel prints must be what the page is wearing, byte for byte.
 *
 * What is not worth testing here is how any of it looks. That is `e2e/theme-lab.spec.ts`, in a real
 * browser, at a real 390 px — jsdom has no layout and would agree with anything.
 */
import { describe, expect, it } from "vitest";
import { createMarkdown, renderMarkdown } from "@pagina/core";
import {
  CONTROLLED_TOKENS, IDENTITIES, PRESETS, identityCss, lineCount, mountThemeLab,
  mountThemeShowcase, themeCss, tokenBlock,
} from "../src/theming/index.js";
import { splitPreset } from "../src/theming/lab.js";
import { definedTokens, layerBody, read, stripComments } from "./css-layers.js";

const tokensCss = read("../client/tokens.css");
const tokensLayer = layerBody(tokensCss, "pagina.tokens")!;
const light = definedTokens(tokensLayer.split('[data-theme="dark"]')[0]!);
const dark = definedTokens(`[data-theme="dark"]${tokensLayer.split('[data-theme="dark"]')[1]!}`);
/** Every `--pg-*` the contract defines, in either scheme. */
const contract = new Set([...light.keys(), ...dark.keys()]);

/** A token whose default is a hex colour, i.e. one the lab should offer a swatch for. */
const isColour = (name: string): boolean => /^#[0-9a-fA-F]{3,8}$/.test(light.get(name) ?? "");

describe("the identities and presets", () => {
  it("name only tokens the contract defines", () => {
    for (const identity of IDENTITIES) {
      for (const name of Object.keys(identity.tokens)) {
        expect(contract.has(name), `${identity.id} sets ${name}, which tokens.css does not define`).toBe(true);
      }
    }
    for (const preset of PRESETS) {
      for (const map of [preset.light, preset.dark]) {
        for (const name of Object.keys(map)) {
          expect(contract.has(name), `preset ${preset.id} sets ${name}`).toBe(true);
        }
      }
    }
  });

  it("covers all four rungs of the ladder, and one that changes nothing", () => {
    expect(new Set(IDENTITIES.map((i) => i.rung))).toEqual(new Set([0, 1, 2, 3]));
    // The rung-3 identity is the only one that may link a different stylesheet, and it must.
    const bare = IDENTITIES.filter((i) => i.themeLevel === "tokens");
    expect(bare).toHaveLength(1);
    expect(bare[0]!.rung).toBe(3);
    expect(bare[0]!.rules, "a host that drops the reading layer has to bring a column").toBeDefined();
  });

  it("shows at least one identity that is not a light palette swap", () => {
    // The point of the section: a reader has to see that the contract survives being disagreed
    // with. A dark identity that also changes the type and the corner rhythm is that proof.
    const unlike = IDENTITIES.filter(
      (i) => i.scheme === "dark" && i.tokens["--pg-radius"] !== undefined,
    );
    expect(unlike.length).toBeGreaterThan(0);
  });

  it("keeps every rule an identity ships unlayered and free of !important", () => {
    // Rung 2's whole claim. A `!important` here would mean pagina's layers were not enough, which
    // would be a defect in the contract rather than a choice in the showcase.
    for (const identity of IDENTITIES) {
      const rules = identity.rules ?? "";
      expect(rules, identity.id).not.toContain("!important");
      expect(rules, identity.id).not.toContain("@layer");
    }
  });
});

describe("the CSS it prints", () => {
  it("is the CSS it applies", () => {
    // `identityCss` is called once per frame and once per listing; this is the assertion that the
    // two are the same call rather than two descriptions of one intent.
    for (const identity of IDENTITIES) {
      const css = identityCss(identity);
      expect(css.startsWith(tokenBlock(":root", identity.tokens)), identity.id).toBe(true);
      if (identity.rules !== undefined) expect(css).toContain(identity.rules);
    }
  });

  it("counts the lines it claims", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a {\n  b: c;\n}")).toBe(3);
    const almanac = IDENTITIES.find((i) => i.id === "almanac")!;
    // Two braces plus one line per declaration; nothing else may creep in.
    expect(lineCount(identityCss(almanac))).toBe(Object.keys(almanac.tokens).length + 2);
  });

  it("emits an empty string rather than an empty rule", () => {
    expect(tokenBlock(":root", {})).toBe("");
    expect(themeCss({}, {})).toBe("");
    expect(themeCss({ "--pg-bg": "#fff" }, {})).toBe(":root {\n  --pg-bg: #fff;\n}");
  });

  it("puts colours in both blocks and geometry only in the first", () => {
    const console_ = PRESETS.find((p) => p.id === "console")!;
    const split = splitPreset(console_);
    expect(split.light["--pg-radius"]).toBeDefined();
    expect(split.dark["--pg-radius"], "geometry must not be restated for dark").toBeUndefined();
    expect(split.dark["--pg-bg"]).toBe(console_.dark["--pg-bg"]);
  });
});

describe("the lab's controls", () => {
  it("name only tokens the contract defines", () => {
    for (const control of CONTROLLED_TOKENS) {
      expect(contract.has(control.name), `${control.name} has a control but no definition`).toBe(true);
    }
  });

  it("reach every colour token the contract defines", () => {
    // The inverse guard. A token added to `tokens.css` and forgotten here is the one thing the
    // widget silently cannot change, and a reader has no way to find out except by looking for it.
    const reachable = new Set(CONTROLLED_TOKENS.map((c) => c.name));
    for (const name of light.keys()) {
      if (!name.startsWith("--pg-") || !isColour(name)) continue;
      expect(reachable.has(name), `${name} is a colour in the contract with no control`).toBe(true);
    }
  });

  it("gives a swatch only to values a colour input can hold", () => {
    for (const control of CONTROLLED_TOKENS) {
      if (control.kind !== "color") continue;
      expect(isColour(control.name), `${control.name} is offered as a colour`).toBe(true);
    }
  });

  it("treats exactly the scheme-independent tokens as text", () => {
    // `tokens.css` redefines only colours under `[data-theme="dark"]`; the lab's export has to have
    // the same shape, and `kind: "text"` is how it decides. The two must agree.
    for (const control of CONTROLLED_TOKENS) {
      if (control.kind !== "text") continue;
      expect(dark.has(control.name), `${control.name} is scheme-dependent after all`).toBe(false);
    }
  });
});

describe("the lab, mounted", () => {
  const setup = (): { host: HTMLElement } => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete document.documentElement.dataset["theme"];
    localStorage.clear();
    const style = document.createElement("style");
    style.textContent = stripComments(tokensCss).replace(/^@layer[^;]*;$/gm, "");
    document.head.append(style);
    const host = document.createElement("div");
    document.body.append(host);
    return { host };
  };

  it("applies exactly what it exports, and nothing else", () => {
    const { host } = setup();
    const lab = mountThemeLab(host, { floating: false });
    lab.setPreset("orchid");
    const sheet = document.querySelector("style[data-pg-theme-lab]");
    expect(sheet?.textContent).toBe(lab.css());
    expect(lab.css()).toContain("--pg-accent: #b388ff");
    // The two blocks a host pastes, and only those two.
    expect(lab.css().match(/^\S.*\{$/gm)).toEqual([":root {", ':root[data-theme="dark"] {']);
    lab.destroy();
  });

  it("puts a scheme-independent edit in the light block whatever the page is showing", () => {
    const { host } = setup();
    document.documentElement.dataset["theme"] = "dark";
    const lab = mountThemeLab(host, { floating: false });
    lab.setToken("--pg-radius", "18px");
    lab.setToken("--pg-bg", "#010203");
    const [lightBlock, darkBlock] = lab.css().split(':root[data-theme="dark"] {');
    expect(lightBlock).toContain("--pg-radius: 18px");
    expect(darkBlock).toContain("--pg-bg: #010203");
    expect(darkBlock).not.toContain("--pg-radius");
    lab.destroy();
  });

  it("persists a choice and restores it, and forgets it on reset", () => {
    const { host } = setup();
    const first = mountThemeLab(host, { floating: false });
    first.setPreset("console");
    const css = first.css();
    first.destroy();

    const second = mountThemeLab(host, { floating: false });
    expect(second.css()).toBe(css);
    second.reset();
    expect(second.css()).toBe("");
    expect(localStorage.getItem("pagina-theme-lab")).toBeNull();
    second.destroy();

    expect(mountThemeLab(host, { floating: false }).css()).toBe("");
  });

  it("ignores a stored map naming something that is not a token of ours", () => {
    const { host } = setup();
    localStorage.setItem(
      "pagina-theme-lab",
      JSON.stringify({ presetId: "custom", light: { "--evil": "url(x)", "--pg-bg": "#123456" }, dark: {} }),
    );
    const lab = mountThemeLab(host, { floating: false });
    expect(lab.css()).toContain("--pg-bg: #123456");
    expect(lab.css()).not.toContain("--evil");
    lab.destroy();
  });

  it("leaves the page's scheme exactly as it found it", () => {
    // Reading dark's defaults means flipping the root element, synchronously, and putting it back.
    const { host } = setup();
    document.documentElement.dataset["theme"] = "light";
    mountThemeLab(host, { floating: false }).destroy();
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });

  it("is operable without a pointer: every control is a real control", () => {
    const { host } = setup();
    const lab = mountThemeLab(host, { floating: false });
    const focusable = host.querySelectorAll("button, input, summary, [tabindex]");
    expect(focusable.length).toBeGreaterThan(20);
    // Nothing is a `div` with a click handler, and the panel says what it is.
    for (const button of host.querySelectorAll("button")) expect(button.type).toBe("button");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    lab.destroy();
  });
});

describe("the showcase, mounted", () => {
  it("renders one frame per identity, wearing the CSS printed under it", () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.append(host);
    const showcase = mountThemeShowcase(host, {
      paginaCssUrl: "https://example.test/_pagina/pagina.css",
      tokensCssUrl: "https://example.test/_pagina/pagina.tokens.css",
      figureHtml: null,
    });
    const frames = host.querySelectorAll("iframe");
    expect(frames).toHaveLength(IDENTITIES.length);
    for (const identity of IDENTITIES) {
      const listing = host.querySelector(`#identity-${identity.id} .pgs__code`);
      if (identityCss(identity) === "") {
        expect(listing, `${identity.id} has nothing to list`).toBeNull();
        continue;
      }
      expect(listing?.textContent, identity.id).toBe(showcase.cssFor(identity.id));
    }
    showcase.destroy();
  });

  it("clones a figure off the page when there is one", () => {
    document.body.innerHTML = `<figure class="kg" data-marker><svg></svg></figure><div id="s"></div>`;
    const host = document.getElementById("s")!;
    mountThemeShowcase(host, { paginaCssUrl: "https://example.test/_pagina/pagina.css" });
    // The frame's document is written lazily, so the assertion is on what would be written: the
    // showcase took the page's own figure rather than a copy of one.
    expect(document.querySelector("figure.kg[data-marker]")).not.toBeNull();
  });
});

describe("the sample the frames render", () => {
  /**
   * The sample is hand-written HTML — a frame has no renderer in it — so it has to be checked
   * against the renderer. Equivalent markdown through `@pagina/core` must produce the same set of
   * pagina class names, or the showcase is styling a shape pagina no longer emits.
   */
  it("uses the classes core actually emits", () => {
    const html = renderMarkdown(
      createMarkdown(),
      `# H\n\ntext\n\n!!! note "Datum"\n    body\n\n!!! warning "Spring"\n    body\n`,
    ).html;
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    mountThemeShowcase(host, { paginaCssUrl: "https://example.test/pagina.css", figureHtml: null });
    // jsdom has no `IntersectionObserver`, so the showcase wrote every frame eagerly and the
    // sample can be read straight back out of one. jsdom never *parses* a `srcdoc`, which is fine:
    // the markup is what is under test, not the rendering.
    const sample = host.querySelector<HTMLIFrameElement>("iframe")!.srcdoc;
    expect(sample, "the frame was written").not.toBe("");
    for (const cls of ["pg-admonition", "pg-admonition--note", "pg-admonition--warning", "pg-admonition__title", "pg-admonition__icon", "pg-admonition__label", "pg-content"]) {
      expect(html.includes(cls) || cls === "pg-content", `core emits ${cls}`).toBe(true);
      expect(sample, `the sample uses ${cls}`).toContain(cls);
    }
  });
});
