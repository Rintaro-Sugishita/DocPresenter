# Inline text

Version 0.1 (draft) · part of the [DocPresenter format specifications](README.md)

A label in a drawing, a cell in a table, and a paragraph in a document are all
prose, so all three take the same inline notation. Someone who has learnt it
once MUST NOT have to learn a second one to put a bold word in a box.

This document specifies that notation. It is deliberately small.

## 1. Where it applies

| Place | Notation |
|---|---|
| A shape's label, a group's label, a connection's label in [`.dgm`](dgm.md) | **this document, in full** |
| A cell and a column header in [`.table`](table.md) | CommonMark inline, plus §2.4 |
| A paragraph in a `.md` document | CommonMark inline, plus §2.4 |

The distinction matters. **A drawing is SVG**, where a styled stretch of text is
a `tspan` and there is no such thing as a link, an image, or a list. So a `.dgm`
label recognises exactly the four constructs in §2 and nothing else. A cell and
a paragraph are HTML, where the whole of CommonMark's inline syntax applies, and
§2 describes the part of it that overlaps plus the one extension.

An implementation that renders `.dgm` labels MUST implement §2 as written here.
An implementation that renders cells MAY hand them to a CommonMark parser, and
SHOULD, since that is what DocPresenter does.

## 2. The constructs

### 2.1 Strong and emphasis

```
**strong**
*emphasis*
```

`**` opens and closes strong. A single `*` opens and closes emphasis. They nest,
in either order.

**`_` is never a mark.** An underscore is a literal underscore, wherever it
appears. Identifiers are full of them, and `user_id_1` is one word, not two
words with something italic in between. This is a departure from CommonMark and
it is intentional; a reader of `.dgm` labels MUST NOT treat `_` as emphasis.

### 2.2 Code

```
`code`
```

A backtick opens a code span; the next backtick closes it. There is no
double-backtick form and no way to put a backtick inside a code span; a label
that needs one writes `` \` `` (§2.5).

### 2.3 Unpaired marks are text

A mark with no closing partner **is the character itself**. `3 * 4` is three
times four. `a ** b` is two asterisks. A reader MUST NOT report an error, and
MUST NOT treat the rest of the label as styled.

This is the rule that keeps the notation usable by people who are not thinking
about notation. Nobody should have to close a marker they did not know they had
opened.

### 2.4 Colour

```
[text]{color=#c62828}
[text]{color=#c22}
```

A bracketed stretch followed immediately — no space — by `{color=…}` is coloured.
The value MUST match `#` followed by exactly three or six hexadecimal digits.
**Anything else is not a colour**: a reader MUST leave the construct as literal
text rather than accepting a colour name, a function, or a longer hex string.
The restriction is a safety rule as much as a stylistic one, since the value
reaches a `fill` attribute or a `style` declaration.

Colour is the author's to choose and carries no defined meaning. Earlier drafts
of DocPresenter restricted it to four meanings (added, changed, removed,
attention); that was dropped, because what changed is better read from the diff
than marked by hand.

A colour applies to the text it brackets, and nests with §2.1 and §2.2 in either
order.

### 2.5 Escaping

A backslash passes the next character through untouched:

```
\*not emphasis\*    →    *not emphasis*
\[text]             →    [text]
\\                  →    \
```

A backslash at the very end of the text is a literal backslash.

## 3. The result

A reader produces a sequence of **runs**. A run is a stretch of text that is
drawn one way throughout, carrying four properties: strong, emphasis, code, and
colour. Runs are flat: nested marks combine into one run's properties rather
than nesting in the output.

For a drawing, this matters twice over:

1. **A run is a `tspan`.** One run, one element, with the properties as
   attributes or classes.
2. **Wrapping measures the text, not the marks.** A label is broken into lines
   by the width of what it shows. `**Web フロント**` is five characters wide, not
   nine. A reader that measures the source string will wrap labels too early,
   and a writer cannot correct for it.

## 4. What is not here

No links, no images, no footnotes, no strikethrough, no subscript, no maths.
Each of them has been left out for the same reason: a drawing cannot show it and
a table cell rarely needs it, and a notation that is bigger than the thing it
describes is a notation people get wrong.

Strikethrough is the one most likely to arrive. When it does, it arrives as
GFM's `~~text~~` and not as anything new
([design/decisions.md](../design/decisions.md): borrow notation, do not invent
it).
