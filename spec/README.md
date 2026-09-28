# DocPresenter file format specifications

Version 0.1 (draft) · 2026-09-28

These documents specify the file formats DocPresenter reads and writes. They are
written for **someone who wants to implement them without asking us**, which is
explicitly allowed: the formats are not covered by the software's licence, and
an independent reader, writer, or editor of these formats needs no permission
from us and owes us nothing
([LICENSE §7](../legal/LICENSE.draft.md), [design/licensing.md §6.4](../design/licensing.md)).

We borrowed most of the notation rather than inventing it. If a construct looks
like Mermaid or like a GFM table, that is deliberate, and the differences are
listed where they occur.

## The documents

| | Format | What it holds |
|---|---|---|
| [`dgm.md`](dgm.md) | **`.dgm`** | A drawing: shapes, connections, hand-placed positions, style |
| [`table.md`](table.md) | **`.table`** | A table: a grid with merged cells, styling, and named ranges |
| [`inline-text.md`](inline-text.md) | — | The inline formatting both formats use inside a label or a cell |

The Markdown document layer — `@import`, sheet separators, heading labels,
cross-references — is **not** specified here yet; see
[Not yet specified](#not-yet-specified).

## How to read these documents

**MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are used as in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Sections marked
*(informative)* describe what DocPresenter happens to do and place no
requirement on an implementation.

Two terms recur:

- A **reader** turns a file into a model. A reader is conformant if it accepts
  every file these documents describe as valid, and reports an error rather than
  guessing for every file they describe as invalid.
- A **writer** turns a model back into a file. A writer has the harder job,
  because these formats exist to be read in a diff; the requirements in
  *Writing* of each document are what keep that true.

## Common ground

The rules below hold for every format specified here.

1. **Encoding is UTF-8**, with no byte order mark. A reader MUST NOT require a
   BOM; it MAY accept and discard one.
2. **Lines end with LF.** A reader MUST also accept CRLF. A writer MUST use LF.
   Nothing in either format depends on the line terminator's length.
3. **Leading and trailing whitespace on a line is not significant.** A reader
   trims each line before interpreting it. Indentation is therefore free, and a
   writer SHOULD keep the indentation a file already uses.
4. **A line whose first non-space character is `#` is a comment**, and carries
   no meaning. A reader MAY keep comments in order to write them back; it MUST
   NOT interpret them.
5. **Blank lines are insignificant** everywhere.
6. **Positions are byte offsets from the start of the file**, counted in UTF-8
   bytes, not in code points or UTF-16 code units. Readers that report positions
   (for an editor, or for an error) MUST count bytes. This is not decoration:
   DocPresenter edits a file by replacing exactly one byte range, and a reader
   whose offsets are in code units cannot be used that way.
7. **Nothing is silently discarded.** A construct a reader does not understand
   MUST be reported — as an error where these documents say a file is invalid,
   and otherwise as a diagnostic. Dropping it on read and losing it on the next
   write is the one behaviour these formats are designed to prevent.

## Versioning of these specifications

A file carries no version number, and this is a decision rather than an
oversight: a version in every file is a diff line that changes for no reason.
Instead, **the formats grow only by addition**. A construct that exists in
version 0.1 keeps its meaning; new constructs are added in a way that older
readers reject loudly (an unknown line, not a silently ignored one).

While these documents are at 0.x, that promise is not yet in force. Breaking
changes will be listed here when they happen.

## Not yet specified

Written down so nobody assumes silence means absence:

- **The document layer** (`.md`): the `@import "…"` directive and its
  attributes, `---` as a sheet separator, `{#label}` on headings, `@label`
  cross-references, and the frontmatter keys. Specified next.
- **Theme files**: which style tokens a theme is expected to resolve. A style
  token is a name in a `.dgm` or `.table` file
  ([`dgm.md` §7](dgm.md), [`table.md` §6](table.md)); what a theme does with it
  is a rendering matter, not a file format one.
- **Import and export mappings**: Mermaid, draw.io, and PPTX round trips, and
  the information each of them loses.
