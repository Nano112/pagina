/**
 * The editor's persistence layer: an optimistic, backend-agnostic mirror of an article folder.
 *
 * The UI talks to {@link ArticleStore}; the store talks to an {@link ArticleBackend}. Nothing here
 * imports `node:*`, Vite or React, so the same code runs in the dev server, in Laravel, and in tests.
 */
export {
  ARTICLE_YAML, ArticleStore,
  type ArticleStoreOptions, type FileConflict, type FileState, type FileStatus,
  type StoreEvent, type StoreEventMap, type StoreStatus,
} from "./article-store.js";
export { noteSelfWrite, type SelfWriteHook } from "./self-write.js";
export { MemoryBackend, type MemoryBackendOptions } from "./memory-backend.js";
export { HttpBackend, type HttpBackendOptions } from "./http-backend.js";
export {
  LocalStorageBackend, StorageQuotaError, hasLocalStorage,
  type LocalStorageBackendOptions, type StorageEventLike, type StorageEventTarget, type StorageLike,
} from "./local-storage-backend.js";
export {
  BackendError, ConflictError,
  type ArticleBackend, type Author, type BackendChange, type Edit, type EditAction,
  type FileEntry, type HistoryOptions, type PublishPayload, type PublishRecord,
  type UploadResult, type WriteOptions, type WriteRecord,
} from "./types.js";
export {
  HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT, LOCAL_AUTHOR, MEMORY_AUTHOR, historyLimit, selectHistory,
} from "./attribution.js";
