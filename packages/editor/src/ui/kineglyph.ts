/**
 * The bridge between a Kineglyph figure and a form that can edit it.
 *
 * A figure in a pagina page is a *module* — `scenes/x.mjs`, evaluated by the browser — and that is
 * the right shape for a hand-authored diagram, but it is not something a form can round-trip. So a
 * builder-authored scene keeps both: the module is the artefact the page loads, and the
 * `SimpleSceneSpec` that produced it is embedded in that same module as pretty-printed JSON, marked
 * with `// pagina:spec`. Re-opening the builder means parsing the JSON back out; a module without
 * the marker is hand-written and the builder refuses to touch it, offering the source editor
 * instead. Round-tripping is exact: `parseSpecFromModule(specToModuleSource(spec))` is `spec`.
 *
 * `previewSpec` is the other half — the same runtime the page uses, mounted into a preview element,
 * so what the builder shows is not an approximation of the figure.
 */
// Bare specifier on purpose: the host page's import map points it at the site's own Kineglyph
// runtime, and the editor bundle keeps it external. See `Preview.tsx`.
import {
  defaultTheme,
  mountKineglyph,
  sceneFromSpec,
  validateSpec,
  type KineglyphController,
  type SimpleSceneSpec,
} from "kineglyph";

/** The line that says "this module was generated from the spec below, and may be re-opened". */
export const SPEC_MARKER = "// pagina:spec";

/**
 * What `mountKineglyph` accepts as a scene.
 *
 * Borrowed from the function rather than imported: `@kineglyph/web`'s bundle re-exports the runtime
 * but not `FigureSource`, and the editor must not reach past the bare `kineglyph` specifier into a
 * package the host page does not necessarily have.
 */
export type SceneSource = Parameters<typeof mountKineglyph>[1]["scene"];

/** The empty scene the builder starts from. */
export function blankSpec(id: string): SimpleSceneSpec {
  return { version: 1, id, title: "", layout: "stack", nodes: [] };
}

/**
 * The module text for a spec.
 *
 * The import is the bare specifier for the same reason everything else here is: the generated file
 * is loaded by the *page*, whose import map owns what `kineglyph` means.
 */
export function specToModuleSource(spec: SimpleSceneSpec): string {
  return `import { sceneFromSpec } from "kineglyph";\n${SPEC_MARKER}\nexport default sceneFromSpec(${JSON.stringify(spec, null, 2)});\n`;
}

/**
 * The spec a generated module was built from, or `null` for any module that was not.
 *
 * Deliberately forgiving about whitespace and about what surrounds the call — an author may have
 * reformatted the file — and deliberately strict about the marker: without it the JSON could be an
 * argument to something else entirely.
 */
export function parseSpecFromModule(source: string): SimpleSceneSpec | null {
  if (!source.includes(SPEC_MARKER)) return null;
  const open = source.indexOf("sceneFromSpec(", source.indexOf(SPEC_MARKER));
  if (open === -1) return null;
  const start = source.indexOf("{", open);
  if (start === -1) return null;
  const json = braced(source, start);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return validateSpec(parsed).ok ? (parsed as SimpleSceneSpec) : null;
}

/** The `{…}` starting at `start`, counting braces outside string literals. */
function braced(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Mounts `spec` into `element`, replacing whatever was there.
 *
 * Throws with Kineglyph's own message when the spec is invalid, which is what the builder shows —
 * there is no second, worse validator here.
 */
export function previewSpec(element: HTMLElement, spec: SimpleSceneSpec): KineglyphController {
  return mountKineglyph(element, { scene: sceneFromSpec(spec), theme: defaultTheme });
}

/** `"nodes[2].kind: expected …"` split into the field it belongs to and what is wrong with it. */
export interface SpecProblem {
  readonly path: string;
  readonly problem: string;
}

/** Kineglyph's `validateSpec` errors, keyed by the form field each one belongs to. */
export function specProblems(spec: unknown): readonly SpecProblem[] {
  return validateSpec(spec).errors.map((message) => {
    const cut = message.indexOf(": ");
    return cut === -1 ? { path: "", problem: message } : { path: message.slice(0, cut), problem: message.slice(cut + 2) };
  });
}

/**
 * Evaluates a scene module in the browser and returns its default export.
 *
 * The module is turned into a `blob:` URL and imported, which is how Kineglyph's own inline-figure
 * loader works: import maps apply to blob modules, so the module's `from "kineglyph"` resolves to
 * the site's runtime. When the page happens to *have* an import map we substitute the resolved URL
 * anyway — a belt-and-braces move that also makes the preview work inside a host (an iframe, a
 * bundler dev overlay) that has no map of its own.
 */
export async function evaluateSceneModule(source: string): Promise<unknown> {
  return (await evaluateModule(source)).default;
}

/**
 * The same evaluation, but handing back the whole module namespace.
 *
 * A *theme* module is the reason: `article.yaml`'s `kineglyph.theme` may export `{ light, dark }`
 * as named exports, as a default object, or both, and publish has to look at all of them.
 */
export async function evaluateModule(source: string): Promise<Record<string, unknown>> {
  const url = URL.createObjectURL(new Blob([rewriteKineglyphImports(source)], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** `from "kineglyph"` → `from "<url the import map gives it>"`, when there is one. */
export function rewriteKineglyphImports(source: string, runtimeUrl = kineglyphRuntimeUrl()): string {
  if (runtimeUrl === undefined) return source;
  return source.replace(/(\bfrom\s*|\bimport\s*\(\s*)(["'])kineglyph\2/g, (_m, lead: string, quote: string) => `${lead}${quote}${runtimeUrl}${quote}`);
}

/** What the host page's import map says `kineglyph` is, if it says anything. */
function kineglyphRuntimeUrl(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const script = document.querySelector('script[type="importmap"]');
  if (script === null) return undefined;
  try {
    const map = JSON.parse(script.textContent ?? "{}") as { imports?: Record<string, string> };
    const url = map.imports?.["kineglyph"];
    return typeof url === "string" && url !== "" ? new URL(url, document.baseURI).href : undefined;
  } catch {
    return undefined;
  }
}
