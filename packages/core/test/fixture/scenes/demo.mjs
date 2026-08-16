import { defineScene, stack, heading } from "kineglyph";
export default defineScene({ schemaVersion: 2, id: "demo", title: "Demo", root: stack("r", [heading("h", "Demo")], { padding: 8, width: "fill" }) });
