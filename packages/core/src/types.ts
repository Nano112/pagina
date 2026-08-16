export interface ContentFs {
  read(path: string): Promise<string>;                 // utf8; throws if missing
  readBinary(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;                // recursive, relative posix paths, files only
}
export interface NavPage { readonly title: string; readonly page: string }             // page = md path relative to folder
export interface NavSection { readonly section: string; readonly children: readonly NavEntry[] }
export type NavEntry = NavPage | NavSection;
export interface ArticleConfig {
  readonly slug: string; readonly title: string; readonly form: "docs";
  readonly status: "draft" | "published"; readonly visibility: "public" | "members" | "authors";
  readonly category?: string; readonly tags: readonly string[];
  readonly theme?: string;
  readonly kineglyph?: { readonly theme?: string; readonly width?: number };   // theme = path to module exporting {light,dark}
  readonly snippets: { readonly roots: readonly string[] };                    // default ["."]
  readonly nav: readonly NavEntry[];
}
export interface Heading { readonly id: string; readonly text: string; readonly level: number }
export interface FigureRef {
  readonly id: string; readonly kind: "inline" | "module" | "static";
  readonly source?: string; readonly scene?: string; readonly static?: string;
}
export interface LinkRef { readonly raw: string; readonly resolved?: string; readonly line?: number }
export interface Diagnostic { readonly severity: "error" | "warning"; readonly code: string; readonly message: string; readonly page?: string }
export interface RenderedPage {
  readonly path: string; readonly href: string; readonly title: string;
  readonly html: string; readonly headings: readonly Heading[];
  readonly figures: readonly FigureRef[]; readonly links: readonly LinkRef[];
}
export interface NavNode { readonly title: string; readonly href?: string; readonly children?: readonly NavNode[] }
export interface PageMeta { readonly title: string; readonly headings: readonly Heading[]; readonly prev?: string; readonly next?: string; readonly breadcrumbs: readonly { title: string; href?: string }[] }
export interface Manifest {
  readonly article: Omit<ArticleConfig, "nav" | "snippets">;
  readonly nav: readonly NavNode[];
  readonly pages: Readonly<Record<string, PageMeta>>;   // keyed by href
  readonly figures: Readonly<Record<string, { readonly page: string; readonly kind: FigureRef["kind"]; readonly scene?: string; readonly staticBase: string }>>;
  readonly assets: readonly string[];
}
export interface RenderedArticle { readonly manifest: Manifest; readonly pages: Readonly<Record<string, RenderedPage>>; readonly diagnostics: readonly Diagnostic[] }
