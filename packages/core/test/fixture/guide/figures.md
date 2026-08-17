# Figures

## First

<figure class="kg" data-scene="../scenes/demo.mjs"><figcaption>Publishing, end to end. Colour comes from the page; everything else was decided when the figure was drawn.</figcaption></figure>

## Second

<figure class="kg" id="inline-demo"><script type="text/kineglyph">
import { defineScene, stack, heading } from "kineglyph";
export default defineScene({ schemaVersion: 2, id: "inline-demo", title: "Inline", root: stack("r", [heading("h", "Inline")], { padding: 8, width: "fill" }) });
</script></figure>

<figure class="kg" data-static="../media/static.svg"><img src="../media/static.svg" alt="static"></figure>

## Opted in

<figure class="kg" data-scene="../scenes/demo.mjs" id="instrument-demo" data-instrument="true"><figcaption>The same diagram, opted into playback and inspection. What it gets is still the scene's decision: a transport because this scene animates, a readout because its boxes can be inspected.</figcaption></figure>

## Asked for chrome

<figure class="kg" data-scene="../scenes/demo.mjs" id="chrome-demo" data-controls="true" data-readout="true"><figcaption>A figure that asked for controls before the default changed still has them, unconditionally — this is what every figure above used to look like.</figcaption></figure>
