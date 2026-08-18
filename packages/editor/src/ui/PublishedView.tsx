/**
 * What the author sees the moment after they press *Publish*: the article, read.
 *
 * Publishing already did the work — every page through `@pagina/core` and every figure to light and
 * dark SVG, in this browser — and then handed the result to a backend and left the author staring
 * at the same editor. A control that does real work and changes nothing you can see is
 * indistinguishable from one that does nothing, which is how "Publish" ended up being described as
 * worse than a disabled button.
 *
 * So the payload is not only shipped, it is *shown*. This is the rendered article — the same HTML
 * the backend was given, figures already inlined — laid out in `.pg-content` with the article's own
 * nav, and one control back to the editor. It is also the clearest possible demonstration of the
 * thing the architecture actually claims: the client rendered this, so there is a reading view even
 * where there is no server.
 */
import { useState, type ReactNode } from "react";
import type { RenderedArticle } from "@pagina/core";
import { ArrowLeft } from "lucide-react";
import { RenderedHtml } from "./RenderedHtml.js";

export interface PublishedViewProps {
  readonly article: RenderedArticle;
  /** The page that was open in the editor; where the reading view starts. */
  readonly path: string;
  readonly publishedAt: string;
  readonly themeUrl?: string | undefined;
  readonly onBack: () => void;
}

/** `2026-08-18T09:12:33.000Z` → `09:12`, in the reader's own locale. */
function at(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? iso : when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function PublishedView({ article, path, publishedAt, themeUrl, onBack }: PublishedViewProps): ReactNode {
  const pages = Object.values(article.pages);
  const start = pages.find((page) => page.path === path) ?? pages[0];
  const [href, setHref] = useState(start?.href ?? "");
  const page = pages.find((candidate) => candidate.href === href) ?? start;

  return (
    <div className="pge-published">
      <div className="pge-published__bar">
        <button type="button" className="pge-btn pge-btn--primary" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> Back to the editor
        </button>
        <span className="pge-published__note">
          Published at {at(publishedAt)} — rendered in this browser
        </span>
        <span className="pge-published__spacer" />
        {pages.length < 2 ? null : (
          <nav className="pge-published__nav" aria-label="Published pages">
            {pages.map((candidate) => (
              <button
                key={candidate.href}
                type="button"
                className="pge-btn pge-btn--sm"
                aria-current={candidate.href === page?.href ? "page" : undefined}
                onClick={() => setHref(candidate.href)}
              >
                {candidate.title}
              </button>
            ))}
          </nav>
        )}
      </div>
      <div className="pge-published__page">
        {page === undefined ? (
          <p className="pge-published__empty">This article has no pages to publish yet.</p>
        ) : (
          <RenderedHtml html={page.html} themeUrl={themeUrl} />
        )}
      </div>
    </div>
  );
}
