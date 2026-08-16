# Basics

A `Schematic` is an editable Minecraft build. It holds blocks, block entities,
entities, metadata, and one or more regions. Start with an empty schematic or
load one from bytes or a file. Coordinates and block-state strings stay the
same when the output format changes.

The Python, JavaScript, and Rust tabs below are cut directly from executable
examples in the repository. The [verification command](#verified-examples) runs
all three versions and checks their block counts, bounds, states, simulation
result, and file round trips.

Rust tabs show the body of a `main` function that returns
`Result<(), Box<dyn std::error::Error>>`, matching the executable source.

## Build a beacon

This first build places a 3 by 3 gold base around the origin, adds the beacon at
`(0, 1, 0)`, and writes a Sponge schematic. The result has 10 non-air blocks and
tight dimensions of `3 × 2 × 3`.

=== "Python"

    ```python
    from nucleation import Schematic

    beacon = Schematic.create("beacon")
    for x in range(-1, 2):
        for z in range(-1, 2):
            beacon.set_block(x, 0, z, "minecraft:gold_block")
    beacon.set_block(0, 1, 0, "minecraft:beacon")
    beacon.save_to_file("beacon.schem")
    ```

=== "JavaScript"

    ```javascript
    import { readFileSync, writeFileSync } from "node:fs";
    import { Schematic } from "nucleation";

    function bytesFromBase64(value) {
      return Uint8Array.from(Buffer.from(value, "base64"));
    }

    const beacon = Schematic.create("beacon");
    for (let x = -1; x <= 1; x += 1) {
      for (let z = -1; z <= 1; z += 1) {
        beacon.setBlock(x, 0, z, "minecraft:gold_block");
      }
    }
    beacon.setBlock(0, 1, 0, "minecraft:beacon");

    const beaconBytes = bytesFromBase64(beacon.toSchematicB64());
    writeFileSync("beacon.schem", beaconBytes);
    ```

=== "Rust"

    ```rust
    use nucleation::UniversalSchematic;
    use std::fs;

    let mut beacon = UniversalSchematic::new("beacon".into());
    for x in -1..=1 {
        for z in -1..=1 {
            beacon.set_block_from_string(x, 0, z, "minecraft:gold_block")?;
        }
    }
    beacon.set_block_from_string(0, 1, 0, "minecraft:beacon")?;
    fs::write("beacon.schem", beacon.to_schematic()?)?;
    ```

The JavaScript package is WASM, so it returns encoded bytes instead of writing
to a filesystem. The example decodes those bytes in Node. In a browser, pass
the resulting `Uint8Array` to a download, upload, or storage API.

<figure markdown="span">
  ![A three-by-three gold-block beacon assembling at the origin of a five-by-five Cartesian grid](../media/readme/basics/beacon.gif){ width="480" }
  <figcaption>Nine gold blocks arrive in loop order, followed by the beacon.</figcaption>
</figure>

[Download the generated beacon](../downloads/readme/basics/beacon.schem)

## Build something with states

The crafting nook uses loops for the floor and walls, then places blocks whose
state matters: upright stripped logs, a south-facing chest, and wall torches
attached in two directions.

=== "Python"

    ```python
    from nucleation import Schematic

    nook = Schematic.create("crafting_nook")
    for x in range(5):
        for z in range(5):
            nook.set_block(x, 0, z, "minecraft:spruce_planks")

    def wall_block(i, y, end_posts):
        if i == 2 and y == 2:
            return "minecraft:light_blue_stained_glass"
        if i in end_posts:
            return "minecraft:stripped_spruce_log[axis=y]"
        return "minecraft:oak_planks"

    for y in (1, 2, 3):
        for x in range(5):
            nook.set_block(x, y, 0, wall_block(x, y, (0, 4)))
        for z in range(1, 5):
            nook.set_block(0, y, z, wall_block(z, y, (4,)))

    nook.set_block(1, 1, 1, "minecraft:crafting_table")
    nook.set_block(3, 1, 1, "minecraft:chest[facing=south]")
    nook.set_block(4, 2, 1, "minecraft:wall_torch[facing=south]")
    nook.set_block(1, 2, 4, "minecraft:wall_torch[facing=east]")
    nook.save_to_file("crafting-nook.schem")
    ```

=== "JavaScript"

    ```javascript
    const nook = Schematic.create("crafting_nook");
    for (let x = 0; x < 5; x += 1) {
      for (let z = 0; z < 5; z += 1) {
        nook.setBlock(x, 0, z, "minecraft:spruce_planks");
      }
    }

    function wallBlock(i, y, endPosts) {
      if (i === 2 && y === 2) return "minecraft:light_blue_stained_glass";
      if (endPosts.includes(i)) return "minecraft:stripped_spruce_log[axis=y]";
      return "minecraft:oak_planks";
    }

    for (const y of [1, 2, 3]) {
      for (let x = 0; x < 5; x += 1) {
        nook.setBlock(x, y, 0, wallBlock(x, y, [0, 4]));
      }
      for (let z = 1; z < 5; z += 1) {
        nook.setBlock(0, y, z, wallBlock(z, y, [4]));
      }
    }

    nook.setBlock(1, 1, 1, "minecraft:crafting_table");
    nook.setBlock(3, 1, 1, "minecraft:chest[facing=south]");
    nook.setBlock(4, 2, 1, "minecraft:wall_torch[facing=south]");
    nook.setBlock(1, 2, 4, "minecraft:wall_torch[facing=east]");
    writeFileSync(
      "crafting-nook.schem",
      bytesFromBase64(nook.toSchematicB64()),
    );
    ```

=== "Rust"

    ```rust
    let mut nook = UniversalSchematic::new("crafting_nook".into());
    for x in 0..5 {
        for z in 0..5 {
            nook.set_block_from_string(x, 0, z, "minecraft:spruce_planks")?;
        }
    }

    let wall_block = |i: i32, y: i32, end_posts: &[i32]| {
        if i == 2 && y == 2 {
            "minecraft:light_blue_stained_glass"
        } else if end_posts.contains(&i) {
            "minecraft:stripped_spruce_log[axis=y]"
        } else {
            "minecraft:oak_planks"
        }
    };

    for y in [1, 2, 3] {
        for x in 0..5 {
            nook.set_block_from_string(x, y, 0, wall_block(x, y, &[0, 4]))?;
        }
        for z in 1..5 {
            nook.set_block_from_string(0, y, z, wall_block(z, y, &[4]))?;
        }
    }

    nook.set_block_from_string(1, 1, 1, "minecraft:crafting_table")?;
    nook.set_block_from_string(3, 1, 1, "minecraft:chest[facing=south]")?;
    nook.set_block_from_string(4, 2, 1, "minecraft:wall_torch[facing=south]")?;
    nook.set_block_from_string(1, 2, 4, "minecraft:wall_torch[facing=east]")?;
    fs::write("crafting-nook.schem", nook.to_schematic()?)?;
    ```

<figure markdown="span">
  ![A compact crafting nook assembling with two centered windows, a crafting table, chest, and two wall torches](../media/readme/basics/animation.gif){ width="480" }
  <figcaption>The floor, walls, furniture, and torches are separate construction groups.</figcaption>
</figure>

[Download the generated crafting nook](../downloads/readme/basics/crafting-nook.schem)

## Coordinates and bounds

Coordinates are signed integers in Minecraft order: `X`, `Y`, `Z`. Positive Y
is up. Placing outside the current region grows it to include the new position,
including negative coordinates.

=== "Python"

    ```python
    from nucleation import Schematic

    build = Schematic.create("signed_coordinates")
    build.set_block(-8, 64, 12, "minecraft:stone")
    build.set_block(24, 80, -3, "minecraft:glass")

    minimum = build.tight_bounds_min()
    maximum = build.tight_bounds_max()
    size = build.tight_dimensions()
    print((minimum.x, minimum.y, minimum.z))  # (-8, 64, -3)
    print((maximum.x, maximum.y, maximum.z))  # (24, 80, 12)
    print((size.x, size.y, size.z))           # (33, 17, 16)
    ```

=== "JavaScript"

    ```javascript
    const build = Schematic.create("signed_coordinates");
    build.setBlock(-8, 64, 12, "minecraft:stone");
    build.setBlock(24, 80, -3, "minecraft:glass");

    const minimum = build.tightBoundsMin();
    const maximum = build.tightBoundsMax();
    const size = build.tightDimensions();
    console.log([minimum.x, minimum.y, minimum.z]); // [-8, 64, -3]
    console.log([maximum.x, maximum.y, maximum.z]); // [24, 80, 12]
    console.log([size.x, size.y, size.z]);          // [33, 17, 16]
    ```

=== "Rust"

    ```rust
    let mut build = UniversalSchematic::new("signed_coordinates".into());
    build.set_block_from_string(-8, 64, 12, "minecraft:stone")?;
    build.set_block_from_string(24, 80, -3, "minecraft:glass")?;

    let bounds = build.get_tight_bounds().expect("the build has blocks");
    println!("{:?}", bounds.min); // (-8, 64, -3)
    println!("{:?}", bounds.max); // (24, 80, 12)
    println!("{:?}", build.get_tight_dimensions()); // (33, 17, 16)

    ```

The minimum and maximum are inclusive, which is why X spans 33 blocks from
`-8` through `24`. Tight bounds describe placed, non-air content. Allocated
dimensions describe internal region storage and can be larger, especially when
a build crosses the origin. Use tight bounds when you mean the visible build.

<figure markdown="span">
  ![Signed coordinate axes assembling from a gold origin across a square grid](../media/readme/basics/coordinates.gif){ width="480" }
  <figcaption>Gold marks the origin. Red and blue mark ±X, orange and purple mark ±Z, and green marks +Y.</figcaption>
</figure>

## Read, replace, and remove blocks

A block-state string is a namespaced block name followed by optional properties:

```text
minecraft:stone
minecraft:oak_log[axis=x]
minecraft:oak_stairs[facing=east,half=bottom,shape=straight]
minecraft:water[level=0]
```

Properties are part of the state, so orientation and variants survive format
round trips. Setting a coordinate again replaces its previous state. Setting
`minecraft:air` removes the block.

=== "Python"

    ```python
    from nucleation import Schematic

    build = Schematic.create("inspect")
    build.set_block(1, 1, 1, "minecraft:oak_log[axis=x]")
    state = build.get_block(1, 1, 1)
    print(state.name())                         # minecraft:oak_log
    print(build.get_block_string(1, 1, 1))      # minecraft:oak_log[axis=x]

    build.set_block(1, 1, 1, "minecraft:air")  # remove it
    ```

=== "JavaScript"

    ```javascript
    const inspect = Schematic.create("inspect");
    inspect.setBlock(1, 1, 1, "minecraft:oak_log[axis=x]");
    console.log(inspect.getBlockName(1, 1, 1));   // minecraft:oak_log
    console.log(inspect.getBlockString(1, 1, 1)); // minecraft:oak_log[axis=x]

    inspect.setBlock(1, 1, 1, "minecraft:air");  // remove it
    ```

=== "Rust"

    ```rust
    let mut inspect = UniversalSchematic::new("inspect".into());
    inspect.set_block_from_string(1, 1, 1, "minecraft:oak_log[axis=x]")?;
    let state = inspect.get_block(1, 1, 1).expect("the block exists");
    println!("{}", state.get_name()); // minecraft:oak_log
    println!("{state}"); // minecraft:oak_log[axis=x]

    inspect.set_block_from_string(1, 1, 1, "minecraft:air")?; // remove it

    ```

Python and JavaScript raise `NotFound` when a lookup is outside every region.
Rust's core `get_block` returns `None`. Use `BlockState` directly when you need
to construct or inspect properties one at a time.

## Content shorthands

Common container and jukebox contents have compact shorthands. They create the
required NBT as the block is placed.

=== "Python"

    ```python
    from nucleation import Schematic

    contents = Schematic.create("contents")
    contents.set_block(0, 0, 0, "minecraft:barrel{signal=13,item=diamond}")
    contents.set_block(1, 0, 0, "minecraft:chest{items=[diamond*64,emerald*12]}")
    contents.set_block(2, 0, 0, "minecraft:jukebox{record=pigstep}")
    contents.set_block(3, 0, 0, "minecraft:jukebox{signal=13}")
    ```

=== "JavaScript"

    ```javascript
    const contents = Schematic.create("contents");
    contents.setBlock(0, 0, 0, "minecraft:barrel{signal=13,item=diamond}");
    contents.setBlock(1, 0, 0, "minecraft:chest{items=[diamond*64,emerald*12]}");
    contents.setBlock(2, 0, 0, "minecraft:jukebox{record=pigstep}");
    contents.setBlock(3, 0, 0, "minecraft:jukebox{signal=13}");
    ```

=== "Rust"

    ```rust
    let mut contents = UniversalSchematic::new("contents".into());
    contents.set_block_from_string(0, 0, 0, "minecraft:barrel{signal=13,item=diamond}")?;
    contents.set_block_from_string(1, 0, 0, "minecraft:chest{items=[diamond*64,emerald*12]}")?;
    contents.set_block_from_string(2, 0, 0, "minecraft:jukebox{record=pigstep}")?;
    contents.set_block_from_string(3, 0, 0, "minecraft:jukebox{signal=13}")?;
    ```

`signal=0..15` fills a container for the requested comparator strength. Add
`item=` to choose the filler. In `items=[...]`, entries occupy consecutive
slots, `*count` defaults to one, and bare item names receive the `minecraft:`
namespace. A jukebox accepts either `record=` or `signal=`. See [Blocks,
entities, and NBT](block-entities-nbt.md) when you need explicit NBT.

## Place through the tick engine

The `{simulate=true}` tag runs the placement through the tick engine. The engine
derives neighbour connections, runs the block's placement behaviour, and writes
the resulting state back. Here the wire arrives connected and powered instead
of keeping a generic default state.

=== "Python"

    ```python
    from nucleation import Schematic

    circuit = Schematic.create("placed_by_engine")
    circuit.set_block(4, 0, 0, "minecraft:redstone_block")
    circuit.set_block(5, 0, 0, "minecraft:redstone_wire{simulate=true}")
    print(circuit.get_block_string(5, 0, 0))
    # minecraft:redstone_wire[east=side,north=none,power=15,south=none,west=side]
    ```

=== "JavaScript"

    ```javascript
    const circuit = Schematic.create("placed_by_engine");
    circuit.setBlock(4, 0, 0, "minecraft:redstone_block");
    circuit.setBlock(5, 0, 0, "minecraft:redstone_wire{simulate=true}");
    console.log(circuit.getBlockString(5, 0, 0));
    // minecraft:redstone_wire[east=side,north=none,power=15,south=none,west=side]
    ```

=== "Rust"

    ```rust
    let mut circuit = UniversalSchematic::new("placed_by_engine".into());
    circuit.set_block_from_string(4, 0, 0, "minecraft:redstone_block")?;
    circuit.set_block_from_string(5, 0, 0, "minecraft:redstone_wire{simulate=true}")?;
    println!("{}", circuit.get_block(5, 0, 0).expect("the wire exists"));
    // minecraft:redstone_wire[east=side,north=none,power=15,south=none,west=side]
    ```

The tag must be the only item inside the braces. Published Python and
JavaScript packages include the tick engine. Rust builds need the `bridge` and
`mc-tick` features. See [placing through the engine](tick-simulation.md#placing-through-the-engine)
for component-scoped and full-world placement.

## Open, edit, and save

Python chooses a writer from the output extension. JavaScript reads and writes
bytes through the host environment. Rust's `UniversalSchematic` exposes format
modules and byte encoders directly.

=== "Python"

    ```python
    from nucleation import Schematic

    copy = Schematic.load_from_file("beacon.schem")
    copy.set_block(0, 2, 0, "minecraft:glass")
    copy.save_to_file("beacon-edited.litematic")
    ```

=== "JavaScript"

    ```javascript
    const copy = Schematic.fromData(readFileSync("beacon.schem"));
    copy.setBlock(0, 2, 0, "minecraft:glass");
    const editedBytes = bytesFromBase64(copy.toLitematicB64());
    writeFileSync("beacon-edited.litematic", editedBytes);
    ```

=== "Rust"

    ```rust
    let bytes = fs::read("beacon.schem")?;
    let mut copy = UniversalSchematic::from_schematic(&bytes)?;
    copy.set_block_from_string(0, 2, 0, "minecraft:glass")?;
    fs::write("beacon-edited.schem", copy.to_schematic()?)?;
    ```

The JavaScript example uses the `readFileSync`, `writeFileSync`, and
`bytesFromBase64` definitions from the first tab. See [Formats and
I/O](formats-and-io.md) for format detection, version selection, all byte APIs,
and round-trip guarantees.

## Animations are generated, too

The three illustrations on this page are rendered from schematics by
`BuildAnimation`. They are not hand-authored mockups. The checked-in generators
record construction groups, set a camera and grid, and render GIF frames with a
Minecraft resource pack. Python and JavaScript expose the generated
`BuildAnimation` API; Rust also exposes the underlying animation builder and
rendering modules.

Start with [Animating a build](animation.md) for effects, grouping, camera
tracks, GIF output, and video assembly. The page generators live beside the
executable examples in `examples/readme/basics/`.

## Verified examples

Run every source embedded above with one command from the repository root:

```bash
./tools/verify-basics-docs.sh
```

The verifier runs each language in a clean temporary directory. It checks exact
bounds and block counts, confirms the block-state and simulated-wire results,
and opens the generated schematic before writing it again. The documentation
build then expands the marked regions from those same files into this page, so
the displayed code and executed code cannot drift independently.

## Next

- [Formats and I/O](formats-and-io.md)
- [Shapes, brushes, and masked fills](shapes-and-brushes.md)
- [Animating a build](animation.md)
