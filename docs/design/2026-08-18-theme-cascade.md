# One theme, inherited — design

Date: 2026-08-18. Status: from the user's brief while dogfooding pagina on Kineglyph's own docs.

## What the user asked for

> ideally we have one default theme, that can be overridden, then maybe a per page theme that can
> override the global theme … and make it so that Kineglyph uses the same theme as the page unless
> the glyph overrides the theme — the idea is that the glyph can inherit the page's theme

Two things, and the second is the interesting one.

## The cascade

Four levels, each overriding the one above, and **each optional**:

| Level | Where it is written | Scope |
|---|---|---|
| 1. pagina's default | `tokens.css` | every page, when nothing else says otherwise |
| 2. the host | a host stylesheet mapping `--pg-*` | every page pagina renders inside that host |
| 3. the article | `article.yaml` `theme:` | every page of that article |
| 4. the page | front matter `theme:` | that page alone |
| 5. the figure | the figure's own declaration | that figure alone |

There is no fifth kind of thing to learn: every level writes the **same `--pg-*` tokens**, and a level
that says nothing inherits. That is the whole model, and the documentation should be able to state it
in those terms rather than as four unrelated mechanisms.

Today levels 1, 2 and 3 exist but are described as separate features ("theming contract", "escape
hatches", "`kineglyph.theme`"), and level 4 does not exist at all. The reading needs rewriting around
the cascade, not around the mechanisms.

## Figures inherit, they do not decide

This is the part that is currently backwards.

`--kg-color-*` already map from `--pg-*`, so a figure drawn with no opinion follows the page for free —
that is right and stays. But an article that sets `kineglyph.theme` gets a theme module that paints
explicit colours at draw time, and since a later task made that module reach the runtime, **the
figure's theme now beats the page's**. So on a dark site a figure declared with a light Kineglyph
theme stays light, and the author has no way to say "just follow the page" short of deleting the
declaration.

Invert the default:

- **A figure inherits the page.** No declaration, no opinion: `--kg-color-*` resolve from `--pg-*`,
  which is what makes a diagram look like it belongs to the article it sits in.
- **A declaration is an override, and it is scoped to what declared it.** `article.yaml` overrides for
  that article; a single `<figure>` overrides for itself. Neither leaks upward.
- **Inheriting must be expressible.** `theme: inherit` (or the absence of a declaration) has to be a
  thing an author can write deliberately, so "follow the page" is a choice and not just a default you
  get by omission.

Geometry stays where it is: text metrics and layout are still measured at publish time. This is about
colour, which is the half that was always meant to be decided at view time.

## Kineglyph's side of it

Kineglyph is general-purpose and must not learn what `--pg-*` is. It already exposes `--kg-color-*`;
what it needs is for a theme to be *optional at every level* — a scene that declares nothing must emit
paints that read from the cascade rather than baking a palette, and a scene that declares a theme must
scope those paints to itself rather than to the document. pagina owns the mapping; Kineglyph owns the
contract.

## The cover, while we are here

On `kineglyph.test` the cover is boxed inside the reading column, cropped mid-wordmark, and cream on a
dark page. A cover is the first thing on the page and should behave like one: full width of the page,
not the measure; sized so the image is not decapitated; and it must not leave the article's title
rendered twice, which is what happens today when the page's own `h1` repeats the header's.
