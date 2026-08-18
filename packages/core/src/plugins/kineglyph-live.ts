import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { escapeHtml } from "markdown-it/lib/common/utils.mjs";

export interface KineglyphLiveOptions {
  readonly view: "source" | "split" | "preview";
  readonly height?: number;
  readonly id?: string;
  readonly autoplay: boolean;
}

const INFO = /^kineglyph(?:\s|$)/;
const LIVE = /(?:^|\s)live(?:\s|$)/;
const VALUE = /([A-Za-z][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
const ID = /^[A-Za-z0-9_.-]+$/;

/** Parses the intentionally small metadata surface after `kineglyph live`. */
export function parseKineglyphLiveInfo(
  info: string,
): KineglyphLiveOptions | undefined {
  const normalized = info.trim();
  if (!INFO.test(normalized) || !LIVE.test(normalized)) return undefined;
  const values = new Map<string, string>();
  for (const match of normalized.matchAll(VALUE))
    values.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  const viewValue = values.get("view");
  const view =
    viewValue === "source" || viewValue === "preview" || viewValue === "split"
      ? viewValue
      : "split";
  const rawHeight = Number(values.get("height"));
  const height =
    Number.isFinite(rawHeight) && rawHeight >= 240 && rawHeight <= 1200
      ? Math.round(rawHeight)
      : undefined;
  const rawId = values.get("id");
  const id = rawId !== undefined && ID.test(rawId) ? rawId : undefined;
  return {
    view,
    ...(height === undefined ? {} : { height }),
    ...(id === undefined ? {} : { id }),
    autoplay: values.get("autoplay") === "true",
  };
}

/** A JavaScript module lives in an HTML raw-text element, where only its closing tag is special. */
function scriptSource(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

/** Turns a live Kineglyph fence into the same inline figure contract Pagina already prerenders. */
export function kineglyphLivePlugin(md: MarkdownIt): void {
  const fallback = md.renderer.rules.fence;
  md.renderer.rules.fence = (
    tokens: Token[],
    index,
    options,
    env,
    self,
  ): string => {
    const token = tokens[index]!;
    const parsed = parseKineglyphLiveInfo(token.info);
    if (parsed === undefined)
      return fallback === undefined
        ? self.renderToken(tokens, index, options)
        : fallback(tokens, index, options, env, self);
    const attrs = [
      'class="kg kg-lab"',
      "data-kineglyph-lab",
      `data-view="${parsed.view}"`,
      ...(parsed.height === undefined
        ? []
        : [`data-height="${String(parsed.height)}"`]),
      ...(parsed.id === undefined ? [] : [`id="${escapeHtml(parsed.id)}"`]),
      ...(parsed.autoplay ? ['data-autoplay="true"'] : []),
      'data-controls="auto"',
      'data-readout="auto"',
      'data-machine-controls="auto"',
    ];
    return `<figure ${attrs.join(" ")}><script type="text/kineglyph">${scriptSource(token.content.trim())}</script></figure>\n`;
  };
}
