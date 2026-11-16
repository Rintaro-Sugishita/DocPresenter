// Inline formatting inside a label.
//
// A shape's text is written the way the rest of the document is written —
// `**strong**`, `*emphasis*`, `` `code` ``, `[text]{color=#c62828}`, and
// Pandoc's `~~struck~~`, `x^2^`, `H~2~O` and `[text]{.underline}` — because a
// label is prose that happens to sit in a box, and someone who has learnt the
// notation once should not have to learn a second one for drawings.
//
// The result is runs rather than HTML: the drawing is SVG, where a run of
// styled text is a `tspan`. Measuring works on the runs too, so a label is
// wrapped by what it shows and not by the marks that produced it.

/** A stretch of label text that is drawn one way throughout. */
export interface Run {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
  /** `#rgb` or `#rrggbb` from a bracketed span, or nothing. */
  readonly colour: string | undefined;
  /** `~~…~~`. Absent and false read the same. */
  readonly strike?: boolean;
  /** `[…]{.underline}`. */
  readonly underline?: boolean;
  /** `^…^` raised, `~…~` lowered; the two do not combine. */
  readonly script?: 'sup' | 'sub' | undefined;
}

/** One line of a wrapped label. */
export type TextLine = readonly Run[];

const PLAIN = { bold: false, italic: false, code: false, colour: undefined } as const;

const COLOUR_SPAN = /^\{color=(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\}/;
const UNDERLINE_SPAN = /^\{\.underline\}/;
/** A space not spelt `\ `: Pandoc's rule, so `3^2 and 4^2` stays as written. */
const BARE_SPACE = /(^|[^\\])(\\\\)*\s/;

/**
 * Reads a label into runs. Anything that is not a complete pair of marks is
 * text: a lone `*` in a label is a lone `*`, not the start of something the
 * author has to close.
 */
export function parseRuns(text: string): Run[] {
  const out: Run[] = [];
  read(text, PLAIN, out, false);
  return out;
}

/**
 * Reads a shape's label: the same notation, and `\n` breaks the line. A label
 * is written on one line of the file, so the break has to be spelt; the run
 * then carries a newline, which the wrap starts a new line at.
 */
export function parseLabel(text: string): Run[] {
  const out: Run[] = [];
  read(text, PLAIN, out, true);
  return out;
}

type Style = Omit<Run, 'text'>;

function read(text: string, style: Style, out: Run[], breaks: boolean): void {
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') { out.push({ ...style, text: buffer }); buffer = ''; }
  };

  for (let i = 0; i < text.length;) {
    const char = text[i]!;
    // A backslash hands the next character through untouched, which is how a
    // label says `*` without meaning emphasis. In a shape's label `\n` is
    // the one exception: it breaks the line.
    if (char === '\\' && i + 1 < text.length) {
      buffer += breaks && text[i + 1] === 'n' ? '\n' : text[i + 1];
      i += 2;
      continue;
    }
    if (char === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ ...style, code: true, text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith('~~', i)) {
      const end = text.indexOf('~~', i + 2);
      if (end > i + 1) {
        flush();
        read(text.slice(i + 2, end), { ...style, strike: true }, out, breaks);
        i = end + 2;
        continue;
      }
    }
    if (char === '^' || char === '~') {
      const end = scriptEnd(text, i);
      if (end !== undefined) {
        flush();
        read(text.slice(i + 1, end), { ...style, script: char === '^' ? 'sup' : 'sub' }, out, breaks);
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 1) {
        flush();
        read(text.slice(i + 2, end), { ...style, bold: true }, out, breaks);
        i = end + 2;
        continue;
      }
    }
    // Only `*` marks emphasis. `_` is left alone: identifiers are full of it,
    // and `user_id_1` is not two words in italics.
    if (char === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1) {
        flush();
        read(text.slice(i + 1, end), { ...style, italic: true }, out, breaks);
        i = end + 1;
        continue;
      }
    }
    if (char === '[') {
      const close = text.indexOf(']', i + 1);
      const found = close > i ? COLOUR_SPAN.exec(text.slice(close + 1)) : null;
      if (close > i && found) {
        flush();
        read(text.slice(i + 1, close), { ...style, colour: found[1]! }, out, breaks);
        i = close + 1 + found[0].length;
        continue;
      }
      const under = close > i ? UNDERLINE_SPAN.exec(text.slice(close + 1)) : null;
      if (close > i && under) {
        flush();
        read(text.slice(i + 1, close), { ...style, underline: true }, out, breaks);
        i = close + 1 + under[0].length;
        continue;
      }
    }
    buffer += char;
    i++;
  }
  flush();
}

/**
 * Where the `^` or `~` opened at `start` closes, or undefined when it does not:
 * an empty pair, a bare space inside, or a `~` that is half of `~~`.
 */
function scriptEnd(text: string, start: number): number | undefined {
  const marker = text[start]!;
  if (marker === '~' && (text[start + 1] === '~' || text[start - 1] === '~')) return undefined;
  let end = start + 1;
  while (end < text.length && text[end] !== marker) end += text[end] === '\\' ? 2 : 1;
  if (end >= text.length || end === start + 1) return undefined;
  if (marker === '~' && text[end + 1] === '~') return undefined;
  return BARE_SPACE.test(text.slice(start + 1, end)) ? undefined : end;
}

/** What a line says, with the marks gone. Used for measuring and for search. */
export function lineText(line: TextLine): string {
  return line.map(run => run.text).join('');
}
