# The `.dgm` drawing format

Version 0.1 (draft) · part of the [DocPresenter format specifications](README.md)

A `.dgm` file is a drawing that a person can read, a machine can render, and a
code review can follow line by line. It exists because the two established
answers each give up something: a hand-placed drawing (PowerPoint, draw.io)
keeps no meaning and produces a diff nobody can read, and a computed drawing
(Mermaid) keeps the meaning but gives the author no way to fix a layout that
came out wrong.

The format's one idea is that **you do not have to choose**:

> The layout is computed by default. Only the positions a person moved by hand
> are recorded, and those always win.

Thirty shapes, three of which someone cared about, is three lines of
coordinates — and the next shape added does not move them.

The [common rules](README.md) — UTF-8, LF or CRLF, trimmed lines, `#` comments, byte
offsets — apply throughout and are not repeated here.

---

## 1. Shape of the file

A file is a sequence of **sections**, with blank lines and comments allowed
between them. A section opens with a line naming it and ending in `{`, and
closes with a line holding the matching `}`.

```
free Authentication {
  …
}

layout {
  …
}

style {
  …
}
```

There are five section names, in three layers:

| Layer | Section | Holds | Required |
|---|---|---|:--:|
| **L1 semantics** | `free` / `flow` / `overlay` | what is in the drawing | **exactly one** |
| **L2 layout** | `layout` | positions a person pinned, corners a line turns through | optional |
| **L3 style** | `style` | the theme, and per-shape appearance | optional |

A file **MUST** contain exactly one of `free`, `flow`, and `overlay`; a reader
MUST report an error when there is none. It **SHOULD** contain at most one
`layout` and one `style`; a reader that finds several MUST merge them in the
order they appear.

Sections MAY appear in any order. A writer SHOULD write them in the order above,
which puts the part a reviewer reads first at the top of the diff.

**Any other line at the top level is an error.** A reader MUST NOT skip it.

### 1.1 The section header

The opening line is the section name, then optional free text, then `{`:

```
free Authentication {
```

The free text is a **title for people**. A reader MAY show it and MUST NOT
attach meaning to it, with two exceptions: `overlay` requires it, and there it is
a quoted path (§5); and in `flow`, a first or last word that is one of Mermaid's
directions says which way the flow runs (§3.5). The text MUST NOT contain `{`.

### 1.2 Why three layers

So that a diff says which kind of change it is without being read closely.

- Semantics changed → only the `free` / `flow` block moved. **Review this.**
- Someone nudged a shape → only `layout` moved. **Skip this.**
- Colours changed → only `style` moved.

"Reviewable" does not mean "small". It means **it is obvious which part of the
diff deserves attention**. Layer separation is how this format gets there;
draw.io's XML fails not because it is verbose but because all three are
interleaved in it.

## 2. Identifiers

An identifier — a shape's id, a group's id, an endpoint of a connection, a style
selector — matches:

```
[A-Za-z0-9_぀-鿿-]+
```

That is ASCII letters and digits, `_`, `-`, and the range U+3040–U+9FFF, which
covers hiragana, katakana, and CJK ideographs. Full-width alphanumerics and
half-width katakana are **not** identifier characters.

Identifiers **MUST** be unique within a file across shapes and groups. A reader
MAY report a duplicate; where it does not, the later definition wins.

Identifiers **MUST** be stable and readable: `db-primary`, not a GUID. This is a
requirement on **writers**, including interactive editors: a generated
identifier that changes between saves destroys the diff, which is the only
reason this format exists. A writer that must invent a name SHOULD derive it
from the kind of shape and the smallest free number (`branch1`, `branch2`).

## 3. The semantics layer: `free` and `flow`

Both sections hold the same three kinds of line. They differ only in what a
renderer does with a shape that has no pin (§4.4):

- **`free`** — the author places everything. A shape with no pin has no position.
- **`flow`** — positions are computed from the connections. A pin is an exception
  to that computation.

They are not two features. `free` is `flow` with the layout layer completely
filled in, and an author may move between them by pinning more or fewer shapes.

### 3.1 A shape

```
id <bracketed label> [:::class]
```

The brackets around the label decide the shape, as in Mermaid:

| Written | Shape | Notes |
|---|---|---|
| `id [text]` | rectangle | |
| `id (text)` | rounded rectangle | |
| `id ([text])` | stadium | start / end of a flow |
| `id [(text)]` | cylinder | a store. The label sits below the lid |
| `id ((text))` | ellipse | |
| `id {text}` | diamond | a decision |
| `id {{text}}` | hexagon | preparation |
| `id [/text/]` | parallelogram | input / output |
| `id [/text\]` | trapezoid, wide at the bottom | **start of a loop** |
| `id [\text/]` | trapezoid, wide at the top | **end of a loop** |
| `id >text]` | note | an aside, not part of the flow |
| `id "text"` | text only, no outline | a caption sitting on something else |

A reader MUST try the pairs in the order given: `[/…\]` before `[/…/]` before
`[…]`, and `{{…}}` before `{…}`. Otherwise a loop start reads as a
parallelogram and a hexagon as a diamond.

A label **MAY be empty** (`id []`). The label takes the inline notation in
[`inline-text.md`](inline-text.md) — `**bold**`, `` `code` ``,
`[text]{color=#c62828}` — because a label is prose that happens to sit in a box.

`:::class` names a style class the theme resolves (§7.3). It is optional and
comes last.

Three bracket pairs deserve a word on why they are here. The **two trapezoids**
are a pair by design: a flowchart's loop needs a start and an end that a reader
recognises as belonging together, and a single shape cannot say that. **Text
only** is a shape rather than a borderless rectangle because a screen mock-up is
mostly labels sitting on other things, and a rectangle with its outline turned
off is indistinguishable from one whose outline went missing.

### 3.2 A connection

```
from <connector> to ["label"]
```

| Connector | Line | Arrowhead |
|---|---|:--:|
| `-->` | solid | yes |
| `->` | solid | yes |
| `--` | solid | no |
| `-.->` | dashed | yes |
| `<-->` | solid | at both ends |
| `<->` | solid | at both ends |
| `<-.->` | dashed | at both ends |

The rule a reader MUST apply is mechanical: the line is **dashed if the
connector contains `.`**, it has an **arrowhead if it ends with `>`**, and a
second one at its start **if it begins with `<`**. That leaves room for `-.-`
to mean a dashed line without an arrowhead when it is added, with no new rule
to learn.

`a <--> b` is one connection, keyed `a->b` like any other. It is not the same
as writing `a --> b` and `b --> a`: those are two connections, each with its own
label and its own bend.

The label, when present, MUST be in double quotes and MUST NOT contain a double
quote. It takes inline formatting.

A connection MUST NOT be written between the same ordered pair twice, because the
layout layer keys a bend by that pair (§4.3). A reader MAY report the duplicate.

An endpoint that names no shape is **not** an error: a reader MUST render what it
can and report a diagnostic naming the missing endpoint. Refusing the whole file
because one name is misspelt leaves the author with a blank canvas and no way to
find the typo.

### 3.3 A group

```
group id ["label"] [direction] { member; member; … }
```

Members are identifiers separated by `;`. The whole group is one line — this is
the one construct that could reasonably have been nested, and is not, so that
adding a member is a one-line diff and a group's own position in `layout` reads
like any other shape's.

A group is drawn as a container behind its members and MAY be given a pin of its
own; DocPresenter writes `z:-1` for groups so that members stay clickable.
Nested groups are not specified in version 0.1, beyond what §3.5 says of a group
with a direction.

### 3.5 Direction

A `flow` runs top to bottom unless it says otherwise, in Mermaid's words:

| Word | The flow runs |
|---|---|
| `TB` | top to bottom (the default) |
| `TD` | top to bottom — Mermaid's other spelling of `TB` |
| `BT` | bottom to top |
| `LR` | left to right |
| `RL` | right to left |

The drawing's direction is a word of its header, first or last, so both
Mermaid's order and a titled header read:

```
flow LR {
flow Login LR {
```

A group takes a direction between its label and its members:

```
group back "Back end" LR { api; auth; log }
```

A group with a direction is laid out **on its own**, in its own direction, and
then takes part in the drawing around it as a single shape the size of its
frame. Its members' connections to shapes outside are drawn as usual. This holds
even when members connect outside — unlike Mermaid, which drops a subgraph's
direction in that case. A group with no direction is a frame drawn round
wherever its members were placed, as before.

A directed group MAY list another group among its members: a directed one is
laid out inside it as one shape, and a plain one has its own members laid out in
the outer group's direction. A shape listed in two directed groups is laid out
in the first, and a reader SHOULD say so. A group that is also a container
(`stack` / `grid` / `tabs` in `layout`, [diagram model §3](../design/diagram-model.md)) is
arranged by the container, so its direction does not apply.

In `free`, nothing is computed, so a direction has nothing to act on; a reader
SHOULD say so rather than ignore it.

### 3.4 Example

```
free {
  browser [User's browser]
  web     [Web front end]
  api     [Auth API]
  db      [(Member DB)]
  note1   >Reachable from the internal network only]

  group dmz   "DMZ"              { web }
  group intra "Internal network" { api; db }

  browser -> web  "HTTPS"
  web     -> api  "gRPC"
  api     -> db
  note1   -- api
}
```

## 4. The layout layer: `layout`

Everything in this section is geometry, and **only what a person decided** is
here. A reader MUST NOT expect a pin for every shape, and a writer MUST NOT add
one for a shape nobody moved.

### 4.1 A pin

```
id @ (x, y) [WxH] [z:N]
```

- `x`, `y` — the top-left corner, integers, possibly negative. Required.
- `WxH` — width and height, positive integers. Optional; a shape without them is
  sized to fit its label.
- `z:N` — stacking order, an integer, possibly negative. Optional, default `0`.
  Larger is in front.

```
layout {
  browser @ ( 40, 120) 140x60
  dmz     @ (220,  80) 180x140  z:-1
  home    @ (320, 640)
}
```

Coordinates are in **CSS pixels at 100% scale**, with x to the right and y down.
There is no unit suffix and no grid; a writer MAY round to a grid of its own
choosing and DocPresenter does, so that the shake of a hand on a mouse produces
no diff at all.

Shapes with the same `z` are drawn in the order they are **declared** in the
semantics layer, so the stacking of two overlapping shapes is decided by the file
and not by a map's iteration order.

A pin is **authoritative**. A renderer that computes positions MUST use the
pinned value unchanged — a computed layout that moved a shape someone placed by
hand would make pinning pointless.

### 4.2 One line per shape, keyed by id

The layout layer is a **map keyed by identifier**, not a list. A writer MUST
write at most one pin per identifier, MUST write each pin on its own line, and
SHOULD keep a stable order (DocPresenter keeps the order the lines already have,
and appends). Adding a shape MUST NOT move another shape's line.

### 4.3 A bend

The corners a connection turns through:

```
from -> to @ (x, y); (x, y); …
```

```
layout {
  api -> db @ (600, 120); (600, 240)
}
```

- At least one point is required; a reader MUST report an error for a bend line
  with none.
- The points are the **intermediate** corners, in order from `from` to `to`. The
  two endpoints are not written: they are wherever the shapes are, which is the
  whole point of not storing them.
- The connection is identified by **its two endpoints only**. The connector
  written here is not compared; a writer SHOULD use `->` whatever the semantics
  layer says, and a reader MUST accept any run of `-` ending in `>`.
- A bend naming a connection that does not exist is a diagnostic, not an error.

Bends live in the layout layer, beside the pins, because a corner is geometry. The
semantics layer says what connects to what and says nothing about the path.

Where a connection has no bend, the renderer decides the path. **This is not a
gap in the format**: a path is computed where it is clear (§8), and a line that
would cross a shape detours around the drawing. An author who dislikes the
result adds corners, and an author who wants the corner gone deletes the line
— which must be possible **in one gesture**, because the alternative is what
happens when a Mermaid flowchart is imported into draw.io and every edge arrives
carrying a dozen waypoints that have to be removed one at a time.

### 4.4 A shape with no pin

| Section | What a renderer MUST do |
|---|---|
| `flow` | compute a position from the connections |
| `free` | place the shape somewhere visible and report a diagnostic |

The second row is a requirement, not a suggestion. A `free` drawing has no
computation to fall back on, so a shape with no pin has no position — and a
renderer that answers by drawing nothing produces a drawing that **lies about
its own contents**. DocPresenter parks such shapes in a row below the drawing,
where they can be seen and dragged into place. It follows that an editor MUST
NOT offer to remove a pin in a `free` drawing: that would be the only statement
of where the shape is.

## 5. The semantics layer: `overlay`

An annotated image. The image is a binary a diff cannot show, so the numbering
and the wording are kept as text beside it.

```
overlay "../assets/login-screen.png" {
  ① @ (168, 126) -> (188, 132)  "Login ID"
  ② @ (168, 186) -> (188, 192)  "Password"
}
```

The header MUST be a quoted path, resolved relative to the `.dgm` file. Each
line is:

```
marker @ (x, y) -> (tx, ty) ["text"]
```

- `marker` — any run of non-space characters. Circled digits are conventional;
  nothing is enforced.
- `(x, y)` — where the marker sits. `(tx, ty)` — what it points at.
- Coordinates are in **the image's own pixels**, so they stay correct when the
  image is displayed at another size.
- The text is optional and takes inline formatting.

An `overlay` file MAY carry a `style` section. `layout` has no meaning in it.

## 6. Reading and writing

### 6.1 Reading

A reader MUST:

- report an error, naming the **1-based line number**, for: an unrecognised
  top-level line, an unclosed section, a shape whose brackets match no pair in
  §3.1, a pin or callout it cannot parse, a bend with no points, a missing
  semantics section, and an `overlay` without a quoted path;
- report a **diagnostic** rather than an error for: a connection endpoint that
  names nothing, a bend for a connection that does not exist, a group member
  that names nothing, and a style declaration it does not recognise;
- carry, for every shape, connection, pin, bend, and callout, **the byte range
  of its own line**.

That last requirement is what makes the format editable in place. An editor that
re-serialises the file to change one position will reformat lines nobody touched,
and the diff stops being reviewable — so every entity carries its own range, and
an edit replaces exactly that range.

### 6.2 Writing

A writer MUST:

1. **Write one entity per line.** A shape, a connection, a group, a pin, a bend,
   a callout — each is exactly one line.
2. **Never write a computed position.** Only what a person placed goes into
   `layout`. Writing the computed ones is the mistake this format exists to
   avoid: after it, adding one shape moves every coordinate in the file.
3. **Write integers** for coordinates and sizes.
4. **Keep identifiers stable** across saves (§2).
5. **Preserve what it does not understand.** Comments, unknown style
   declarations, and section titles survive a read-modify-write cycle.
6. **Change only what changed.** Each edit replaces one byte range. A writer that
   rewrites the whole file on every change satisfies this format's grammar and
   defeats its purpose.

## 7. The style layer: `style`

```
style {
  theme: default
  dmz   { line: dashed }
  api   { fill: #e3f2fd, color: #0d47a1 }
  edge1 { icon: net/router }
}
```

### 7.1 `theme`

`theme: name` names the theme that resolves every token in this section. One per
file; the last wins.

### 7.2 A rule

```
selector { property: value, property: value }
```

The selector is an identifier — a shape or a group. Declarations are separated by
`,` or `;`. A line this grammar does not match is **ignored** rather than being
an error, so that a file written by a later version still renders here; a reader
SHOULD report it as a diagnostic.

### 7.3 Values: a colour or a token

A value matching `#rgb` or `#rrggbb` is **a colour the author chose**, applied
directly. Any other value is **a token the theme resolves**, and a renderer
passes it on as a name (DocPresenter emits the class `dp-<property>-<value>`).
This split is the whole of the style model: `fill: #e3f2fd` is one drawing's
decision, `fill: changed` is a decision the document makes once, in its theme.

Recognised properties in version 0.1:

| Property | Colour | Token | Meaning |
|---|:--:|:--:|---|
| `fill` | yes | yes | the shape's interior |
| `line` | yes | yes | its outline. `line: dashed` is the common token |
| `color` | yes | yes | its label |
| `align` | no | yes | where the label sits: `left`, `center`, `right` |
| `icon` | no | — | a picture inside the shape (§7.4) |

A property not listed here is passed through as a token. A reader MUST NOT reject
it.

A `:::class` on a shape (§3.1) names a class the theme resolves, and is the right
place for "this shape means the same as those other three". A rule keyed by id is
the right place for "this one shape is different".

### 7.4 `icon`: a picture, not a shape

```
api    { icon: net/router }
lambda { icon: ./icons/lambda.svg }
```

`icon` takes either:

- **a built-in part name.** Version 0.1 defines ten, all drawn on a 24×24 grid:
  `net/cloud`, `net/internet`, `net/vpn`, `net/router`, `net/switch`,
  `net/firewall`, `net/server`, `net/storage`, `net/user`, `net/mobile`.
- **a path** ending in `.svg` or `.png`, resolved relative to the `.dgm` file.

The distinction between §3.1 and this one is deliberate and worth stating,
because it is the answer to "where do the AWS icons go". **Shapes are a
vocabulary**: a dozen of them, fixed, each with a meaning a reader of a flowchart
already knows, and each offered when converting one shape into another. **Parts
are pictures**: there are hundreds, they mean whatever the vendor says they mean,
and a list of hundreds offered alongside "diamond" and "cylinder" makes the
vocabulary unusable. So parts are named or pointed at, and **no vendor icon set
is bundled** — a drawing that wants AWS icons points at the set the author
already has, whose licence is between the author and its owner.

An `icon` a renderer cannot resolve MUST be shown as a visible mark and reported
as a diagnostic — never drawn as nothing.

## 8. Rendering (informative)

None of this section is required of an implementation. It is here so that two
renderers can agree, and so that a `.dgm` file drawn in one tool does not
surprise its author in another.

DocPresenter's renderer uses, in CSS pixels:

| | |
|---|---|
| Default shape size | 150 × 56 |
| Widest a label may make a shape | 260 |
| Label font size / line height | 14 / 20 |
| Padding inside a shape | 24 |
| Margin around the drawing | 16 |
| Between rows of a computed layout | 72 |
| Between shapes in the same row | 36 |
| Between a group's border and its contents | 20 |
| Extra room for a group's own label | 18 |
| Room a cylinder's lid takes | 24 |
| Room a part's picture takes above its label | 44 |
| Connection label font size | 12 |
| Radius a `flow` connection turns its corners on | 8 |

A shape with no pinned size is measured from its label: the label is broken into
lines by the width of **what it shows**, with the inline marks removed
([`inline-text.md`](inline-text.md) §3), and the shape grows to fit up to the
maximum width.

Connections are routed centre to centre and clipped at the two outlines. In a
`free` drawing the route is a straight line. In a `flow` it runs only up, down
and across: between shapes one above the other it leaves through the bottom,
turns across half way down the gap and enters through the top (sideways for
shapes side by side), and ends already in line are joined straight. Where that
route would cross another shape — which pinning makes possible — it detours
through a channel beside the drawing rather than through it.

Two connections between the same two shapes — `a -> b` and `b -> a`, in any
section — are drawn side by side, 18 apart (26 when either has a label), rather
than one on top of the other. A connection with a bend written for it is left
where its author put it.

In a `flow`, every corner of a connection — computed or written as a bend — is
drawn turning on a short curve of the radius above, tighter where a segment is
too short for it. This is drawing only: the corners are still the points the
route and the file hold, so it is not the curved connection §9 leaves out.

`flow` computes positions by ranking shapes along the connections, then placing
each rank as a row — or as a column, in a flow that runs across the page (§3.5).
There a connection leaves and enters through the sides, and detours above and
below the drawing instead of beside it. Pins override the result, which means a pinned shape can pull
a line across the drawing; that is the author's choice and the renderer does not
second-guess it.

## 9. Not in version 0.1

Stated so that an implementer knows these are absent rather than undocumented:
ports on a shape (`web.right -> api.left`), nested groups, swimlanes, layers,
curved connections (as opposed to the rounded corners of §8), `-.-` (dashed,
no arrowhead), and any way to set a font.
