// Stands in for Task 8's shell client: what matters here is that `kineglyph` stays a bare
// import in the emitted bundle, satisfied by the page's import map at runtime.
import { mountAll } from "kineglyph";
export const ready = typeof mountAll;
