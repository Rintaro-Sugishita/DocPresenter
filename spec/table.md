# The `.table` table format

Version 0.1 (draft) · part of the [DocPresenter format specifications](README.md)

A `.table` file is a table that reads as a GFM table, merges cells like a
spreadsheet, and produces a diff in which one changed cell is one changed line.

It exists because a design document's tables are the part that outgrows Markdown
first. A GFM table cannot merge cells, cannot hold a bulleted list in a cell,
cannot set a column width, and cannot be styled — and every existing answer to
that (an HTML table, a spreadsheet, a Word document) gives up the diff.

So: **keep the grid, add the four things, and keep every addition out of the
grid.** Merging is a single character inside the grid; everything else lives in
sections below it.

The [common rules](README.md) — UTF-8, LF, trimmed lines, `#` comments, byte
offsets — apply throughout and are not repeated here.

---

## 1. Shape of the file

```
# an optional comment or two

| header | header |
|--------|--------|
| cell   | cell   |

[@1]:
- block content a cell refers to

range {
  name: first..last
}

style {
  theme: grid
  col:header { width: 30% }
}
```

In order:

1. **Comments and blank lines** (optional).
2. **The grid** (required): consecutive lines beginning with `|`.
3. **Sections** (optional, any order, repeatable): block definitions (§4),
   `range { … }` (§5), `style { … }` (§6), separated by blank lines or comments.

The grid ends at the first line that does not begin with `|`. A reader MUST
report an error when fewer than two grid lines are found, and for any line after
the grid that matches none of the section forms. **A line is never skipped
silently.**

## 2. The grid

```
| 分類 | No | 項目名      | 型             | 必須 | 説明           |
|------|---:|------------|----------------|:----:|----------------|
| 入力 |  1 | ログイン ID | `varchar(64)`  |  ○   | メール形式。@1 |
| ^    |  2 | パスワード   | `varchar(255)` |  ○   | 8 文字以上     |
```

- The **first** grid line is the header row.
- The **second** is the delimiter row. Every one of its cells MUST match
  `:?-+:?`; a reader MUST report an error otherwise.
- Every line after that is a body row.

### 2.1 Splitting a line into cells

A grid line starts with `|`. Cells are what lies between the pipes, each trimmed
of surrounding spaces. `\|` is a **literal pipe** and does not split.

A trailing `|` is conventional and its empty trailing cell is discarded, so
`| a | b |` and `| a | b` both hold two cells. A row with fewer cells than the
header has is padded with empty cells; extra cells beyond the header's count are
ignored.

Alignment inside the line is free. Writers SHOULD pad cells so that the pipes
line up, because that is what makes the grid readable as text — but a reader MUST
NOT depend on it, and MUST NOT treat a change in padding as a change in content.

### 2.2 Column alignment

From the delimiter row, as in GFM:

| Delimiter | Alignment |
|---|---|
| `---` | the theme's default |
| `:---` | left |
| `---:` | right |
| `:---:` | centre |

One alignment per column. A rule (§6) MAY override it, including for the header
alone — a table of figures usually wants its headings centred over
right-aligned numbers.

### 2.3 Merging

Two markers, each **the entire content of its cell**:

| Marker | Means |
|---|---|
| `^` | this position belongs to the cell **above** |
| `<` | this position belongs to the cell **to the left** |

```
| 入力 |  1 | ログイン ID |
| ^    |  2 | パスワード   |
| ^    |  3 | 保持        |
```

「入力」 covers three rows. And across:

```
| 期間        | <    | 備考 |
| 2026-04-01  | 2026-09-30 | — |
```

The rules a reader MUST apply:

1. `^` extends the cell that covers the same column in the row above. A `^` with
   nothing above it is an error.
2. `<` extends the cell covering the position to its left — which may be a cell
   that started on this row, or one spanning down from above. A `<` in the first
   column is an error.
3. **Only the row a cell starts on decides its width.** A `<` on a later row
   records that the position is covered; it does not widen the cell again.
4. A block merged downwards and then rightwards is written `^` on the rows below
   and `<` to the right, in any combination; a `^` below a `<` finds the same
   owner.
5. A cell that spans several columns is marked `^` **once per column** on the row
   below, and its row span grows once for that row, not once per marker.

`^` and `<` are the only departures from GFM in the grid, and they are one
character each so that the grid stays a grid. A merged table is still readable as
text, which is the property being protected.

### 2.4 Cell content

A cell holds **inline text** ([`inline-text.md`](inline-text.md)): the same
notation as the document's prose, including `**bold**`, `` `code` ``, and
`[text]{color=#c62828}`. The header row is a row of cells and takes the same.

A cell whose **entire** content is `@key` is replaced by the block of that name
(§4). A `@key` in the middle of other text is left alone — a cell is either a
value or a reference, never half of each.

A cell MUST NOT contain a newline. Where a cell needs a list or a paragraph, that
is what §4 is for.

## 3. Rows and columns are named, not numbered

Everything outside the grid that refers into it does so **by text**:

- a **column** is named by its header text;
- a **row** is named by the text of its **leading cell**.

```
col:説明        { width: 38% }
cell:表示/説明  { fill: #fdf0d5 }
認証関連: アクセストークン..セッションキャッシュ
```

Not `col:7` and not `row:12`. This is the single most consequential decision in
the format, and the reason is the diff: insert a row into a table with numbered
references and every reference below it changes, in a section nobody was editing.
Named references survive rows moving, and a reader can see what they point at.

The cost is stated plainly: **renaming a leading cell breaks the references to
that row**. A reader MUST report a reference that resolves to nothing as a
diagnostic rather than failing, and an editor SHOULD offer to rewrite the
references when it renames a leading cell.

## 4. Block content: `[@key]:`

What a cell cannot hold, because it would need a newline.

```
[@1]:
- 大文字小文字は区別しない
- 前後の空白は除去してから検証する

[@2]:
認証失敗時は理由を区別せず「ID またはパスワードが違います」と表示する。
```

- The definition opens with `[@key]:` where `key` is any run of characters other
  than `]`. Content MAY begin on the same line.
- It continues until a blank line, the next `[@…]:`, or a `style {` / `range {`
  line. Lines are trimmed and joined with a newline.
- The block is rendered where a cell says `@key` (§2.4), as Markdown. A block
  nothing refers to is unused, which is not an error.

The grid keeps its shape — a cell holds `@1`, one short token — and the paragraph
lives below, where it can be as long as it needs to be.

## 5. Named ranges: `range { … }`

```
range {
  認証関連:   アクセストークン..セッションキャッシュ
  ネットワーク: DMZ..IdP
}
```

Each line is `name: first..last`, where `first` and `last` are the leading-cell
texts of the range's first and last rows (§3). A line this grammar does not match
is ignored.

A named range does two things: a style rule may select it (§6.2), and a document
that imports the table may import **only that range**, which is what makes a long
table usable in a specification that needs eight of its rows.

## 6. Style: `style { … }`

```
style {
  theme: grid
  col:分類       { width: 18% }
  col:説明       { width: 38% }
  cell:表示/説明 { fill: #fdf0d5 }
}
```

`theme: name` names the theme. One per file; the last wins.

### 6.1 A rule

```
selector { property: value, property: value }
```

Declarations are separated by `,`. A line this grammar does not match is
**ignored** rather than being an error, so a file written by a later version
still renders; a reader SHOULD report it as a diagnostic.

### 6.2 Selectors

| Selector | Selects |
|---|---|
| `header` | the header row |
| `col:NAME` | every cell of the column whose header is `NAME` |
| `NAME` | the same — a bare name is a column |
| `row:odd` / `row:even` | body rows, counted from 1 |
| `row:all` | every body row |
| `cell:ROW/COL` | one cell, by leading-cell text and header text |
| `range:FIRST..LAST` | the rows from `FIRST` to `LAST` (§3) |
| `range:NAME` | the rows of the named range `NAME` (§5) |

`row:odd` and `row:even` exist for striping, and a note about them: **striping is
a theme's business**, and a table that sets it per file is usually a table
fighting its theme. The selectors are here because a reader must understand a
file that uses them, not because a writer should reach for them.

### 6.3 Declarations

| Property | Applies to | Value |
|---|---|---|
| `align` | a column, a header, a cell | `left`, `center`, `right` |
| `width` | a column only | a length: `30%`, `4em`, `120px`, `8ch` |
| `fill` | anything | a colour or a token |
| `color` | anything | a colour or a token |

As in [`.dgm`](dgm.md), a value matching `#rgb` or `#rrggbb` is **a colour the
author chose** and is applied directly; **any other value is a token** the theme
resolves, and a renderer passes it on as a name (DocPresenter emits the class
`dp-<property>-<value>`). A property not listed above is passed through as a
token; a reader MUST NOT reject it.

`width` is the exception that proves the rule: it is a **measurement**, not a
token, and it is written as a real length because no theme can know how wide the
「備考」 column of one particular table should be.

A value that claims to be a colour but does not match the two hex forms MUST NOT
be emitted as a colour. The check is a safety rule: the value reaches a `style`
attribute.

## 7. Reading and writing

### 7.1 Reading

A reader MUST:

- report an error, naming the **1-based line number**, for: a grid of fewer than
  two lines, a malformed delimiter row, a `^` with nothing above it, a `<` in the
  first column, and any unrecognised line after the grid;
- report a **diagnostic** for: a reference that resolves to nothing (`@key`,
  `col:`, `cell:`, `range:`), and a style declaration it does not recognise;
- resolve, for any grid position, the cell covering it, so that a position inside
  a merged block is understood as part of that block;
- carry **the byte range of each grid line**, of each style rule, and of the
  `style` block itself.

The last point is the same requirement as in `.dgm`, with one difference worth
explaining: a cell does **not** carry its own byte range — **the line does**. A
cell is edited by rewriting its own line, because the escaping (`\|`) and the
padding inside a line are easier to get right by substituting one field than by
tracking a range per cell, and one line is already a small enough edit.

### 7.2 Writing

A writer MUST:

1. **Change one line per edited cell.** Not the grid, not the file.
2. **Keep the pipes aligned** after an edit, so that the file stays readable as
   text. Where a value grows past the column's padding, the whole column may be
   re-padded — that is a legible diff of one column, not a reformat of the file.
3. **Never renumber anything**, because nothing is numbered (§3).
4. **Preserve what it does not understand**: comments, unused blocks, unknown
   style declarations, and unknown sections survive a read-modify-write cycle.
5. **Write `—` or an empty cell for "nothing"** consistently, and never write a
   marker (`^`, `<`) as a value.

### 7.3 Interoperating with a spreadsheet

Not part of the format, but the thing implementers ask about: a table in a design
document usually starts life in Excel. A grid editor SHOULD accept
tab-separated text on paste, one line per row, and produce the same on copy.
A merged cell copies as its text in its starting position and empty strings
elsewhere; on paste, the markers are not interpreted — a pasted `^` is the
character `^`, and a tool that guessed otherwise would silently merge cells
nobody asked to merge.

## 8. Not in version 0.1

Stated so that an implementer knows these are absent rather than undocumented: a
newline inside a cell, nested tables, formulas, sorting or filtering recorded in
the file, per-cell borders, a row height, and a footer row distinct from the body.
