/**
 * React bindings for {@link ArticleStore}.
 *
 * The store is a plain event emitter, not a React store: `store.files` builds a fresh `Map` on
 * every call, so it can never be a `useSyncExternalStore` snapshot (React would see a new object
 * each time and re-render forever). What is stable is a *revision counter* — one number per store,
 * bumped whenever the store emits anything — so components subscribe to the number and then read
 * whatever they need straight off the store during render.
 */
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { ArticleStore, FileState, StoreStatus } from "../store/index.js";

const revisions = new WeakMap<ArticleStore, number>();

const revisionOf = (store: ArticleStore): number => revisions.get(store) ?? 0;

/**
 * Re-renders the caller on every store event and returns the store's revision.
 *
 * Several components subscribing to the same store all bump the same counter; that is harmless,
 * because React batches the resulting renders and every one of them reads the same final value.
 */
export function useStoreRevision(store: ArticleStore): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const bump = (): void => {
        revisions.set(store, revisionOf(store) + 1);
        onChange();
      };
      const offs = [store.on("change", bump), store.on("status", bump), store.on("files", bump)];
      return () => {
        for (const off of offs) off();
      };
    },
    [store],
  );
  return useSyncExternalStore(
    subscribe,
    () => revisionOf(store),
    () => 0,
  );
}

/** The store's aggregate status, kept live. */
export function useStoreStatus(store: ArticleStore): StoreStatus {
  useStoreRevision(store);
  return store.status;
}

/** Every file the store has in its mirror, kept live. */
export function useFiles(store: ArticleStore): ReadonlyMap<string, FileState> {
  useStoreRevision(store);
  return store.files;
}

/**
 * The store, for components too deep to reach it by prop — node views in particular, which TipTap
 * renders through a portal into this same React tree.
 */
const StoreContext = createContext<ArticleStore | undefined>(undefined);

export const StoreProvider = StoreContext.Provider;

/** Throws when used outside a mounted editor, which is a wiring bug rather than a runtime state. */
export function useArticleStore(): ArticleStore {
  const store = useContext(StoreContext);
  if (store === undefined) throw new Error("pagina: useArticleStore() outside <PaginaEditor>");
  return store;
}
