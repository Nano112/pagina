/**
 * `@pagina/editor` — the WYSIWYG editor for pagina's markdown dialect.
 *
 * The headless document model (schema + markdown parser/serializer) lives behind the `./model`
 * subpath so it can be used without pulling in any UI; the editor components land here in plan B.
 */
export * from "./model/index.js";
