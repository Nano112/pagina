# Figures

## First

<figure class="kg" data-scene="../scenes/demo.mjs"></figure>

## Second

<figure class="kg" id="inline-demo"><script type="text/kineglyph">
import { defineScene, stack, heading } from "kineglyph";
export default defineScene({ schemaVersion: 2, id: "inline-demo", title: "Inline", root: stack("r", [heading("h", "Inline")], { padding: 8, width: "fill" }) });
</script></figure>

<figure class="kg" data-static="../media/static.svg"><img src="../media/static.svg" alt="static"></figure>
