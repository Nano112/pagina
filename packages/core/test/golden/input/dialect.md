# Dialect corners

Hand-written golden input: every construct the block plugins own, including the ones the
fixture and the Nucleation pages happen not to use (collapsible admonitions, nesting,
escaping, two tab groups on one page).

## Tabs

=== "Python"

    ### Heading inside a tab

    ```python
    print("hello")
    ```

    - a list item
    - another

=== "Rust & <friends>"

    Some **bold** prose, a [link](other.md) and `code`.

    > A blockquote inside a tab.

    | a | b |
    | - | - |
    | 1 | 2 |

=== "Nested"

    !!! note "Admonition inside a tab"

        With a body, and a nested fence:

        ```
        raw
        ```

Prose between the two groups.

=== "Second group, first tab"

    Body one.

=== "Second group, second tab"

    Body two.

## Admonitions

!!! note

    Default title from the kind.

!!! warning "Careful & <sharp>"

    A body with a paragraph,

    and a second paragraph.

??? tip "Collapsible with a title"

    Hidden until opened.

???

    Not an admonition — the marker needs a kind.

??? danger

    Collapsible, default title.

!!! info "With a heading"

    #### Heading inside an admonition

    Text after the heading.

## After the blocks

<figure markdown="span">
  ![A](media/x.gif){ width="480" }
  <figcaption>Caption with *emphasis*.</figcaption>
</figure>

<div markdown="1">

**Block markdown** inside raw HTML.

</div>

<figure class="kg" data-scene="scenes/demo.mjs"></figure>

A final paragraph. {.trailing}
