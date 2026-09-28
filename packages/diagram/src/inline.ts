// Inline formatting inside a label.
//
// A shape's text is written the way the rest of the document is written —
// `**strong**`, `*emphasis*`, `` `code` ``, `[text]{color=#c62828}` — because a
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
}

/** One line of a wrapped label. */
export type TextLine = readonly Run[];

const PLAIN = { bold: false, italic: false, code: false, colour: undefined } as const;

const COLOUR_SPAN = /^\{color=(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\}/;

/**
 * Reads a label into runs. Anything that is not a complete pair of marks is
 * text: a lone `*` in a label is a lone `*`, not the start of something the
 * author has to close.
 */
export function parseRuns(text: string): Run[] {
  const out: Run[] = [];
  read(text, PLAIN, out);
  return out;
}

type Style = Omit<Run, 'text'>;

function read(text: string, style: Style, out: Run[]): void {
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') { out.push({ ...style, text: buffer }); buffer = ''; }
  };

  for (let i = 0; i < text.length;) {
    const char = text[i]!;
    // A backslash hands the next character through untouched, which is how a
    // label says `*` without meaning emphasis.
    if (char === '\\' && i + 1 < text.length) {
      buffer += text[i + 1];
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
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 1) {
        flush();
        read(text.slice(i + 2, end), { ...style, bold: true }, out);
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
        read(text.slice(i + 1, end), { ...style, italic: true }, out);
        i = end + 1;
        continue;
      }
    }
    if (char === '[') {
      const close = text.indexOf(']', i + 1);
      const found = close > i ? COLOUR_SPAN.exec(text.slice(close + 1)) : null;
      if (close > i && found) {
        flush();
        read(text.slice(i + 1, close), { ...style, colour: found[1]! }, out);
        i = close + 1 + found[0].length;
        continue;
      }
    }
    buffer += char;
    i++;
  }
  flush();
}

/** What a line says, with the marks gone. Used for measuring and for search. */
export function lineText(line: TextLine): string {
  return line.map(run => run.text).join('');
}
