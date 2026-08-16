/**
 * The editor's persistence layer: an optimistic, backend-agnostic mirror of an article folder.
 *
 * The UI talks to {@link ArticleStore}; the store talks to an {@link ArticleBackend}. Nothing here
 * imports `node:*`, Vite or React, so the same code runs in the dev server, in Laravel, and in tests.
 */
export {
  ArticleStore,
  type ArticleStoreOptions, type FileConflict, type FileState, type FileStatus,
  type StoreEvent, type StoreEventMap, type StoreStatus,
} from "./article-store.js";
export { MemoryBackend, type MemoryBackendOptions } from "./memory-backend.js";
export { HttpBackend, type HttpBackendOptions } from "./http-backend.js";
export {
  BackendError, ConflictError,
  type ArticleBackend, type BackendChange, type FileEntry, type PublishPayload,
  type UploadResult, type WriteOptions,
} from "./types.js";
