/**
 * The three things a node view needs that are not in the node.
 *
 * A TipTap node view is rendered through a portal into this React tree, so it can reach context but
 * not props: it cannot be told which page it is on, where the `<model-viewer>` module lives, or how
 * to raise the figure builder. Those are exactly the three, and they are contexts rather than a
 * single "app" object so that a test can supply one without inventing the other two.
 *
 * `useStore.ts` holds the fourth, the store itself.
 */
import { createContext, useContext } from "react";
import type { SimpleSceneSpec } from "kineglyph";

/**
 * Google's `<model-viewer>` element, which is not bundled: it is 300 kB of WebGL that most pages
 * never need, and a site that self-hosts it must be able to say so.
 */
export const DEFAULT_MODEL_VIEWER_URL = "https://ajax.googleapis.com/ajax/libs/model-viewer/4.3.1/model-viewer.min.js";

export interface EditorConfig {
  /** Where the `<model-viewer>` custom element is loaded from. */
  readonly modelViewerUrl: string;
}

const ConfigContext = createContext<EditorConfig>({ modelViewerUrl: DEFAULT_MODEL_VIEWER_URL });

export const ConfigProvider = ConfigContext.Provider;

export const useEditorConfig = (): EditorConfig => useContext(ConfigContext);

/** The markdown file currently open, so a node view can turn a folder path into a relative href. */
const PagePathContext = createContext<string>("index.md");

export const PagePathProvider = PagePathContext.Provider;

export const usePagePath = (): string => useContext(PagePathContext);

/** What the builder is opened with, and what it does when the author saves. */
export interface FigureBuilderRequest {
  /** The spec to edit; omitted for a new figure. */
  readonly spec?: SimpleSceneSpec | undefined;
  /** The scene file being edited, folder-relative; omitted for a new figure. */
  readonly scenePath?: string | undefined;
  /** Called after the module has been written, with the scene's folder-relative path. */
  readonly onSave: (scenePath: string, spec: SimpleSceneSpec) => void;
}

/** `undefined` outside a mounted app, which is why every caller guards on it. */
const FigureBuilderContext = createContext<((request: FigureBuilderRequest) => void) | undefined>(undefined);

export const FigureBuilderProvider = FigureBuilderContext.Provider;

export const useFigureBuilder = (): ((request: FigureBuilderRequest) => void) | undefined =>
  useContext(FigureBuilderContext);
