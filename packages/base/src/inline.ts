// Inline formatting: bold, italic, code and colour.
//
// These work on the text of one block, in string indices, because that is what
// a text box hands you. The byte-range discipline applies where it matters —
// the block is written back to the file as one byte-range replacement — and
// forcing byte arithmetic in here as well would only obscure the logic.
//
// Colour is the author's to choose. It was once restricted to four meanings,
// on the argument that a colour cannot be read back by a machine or a
// greyscale printer. What broke that argument is that the meanings were mostly
// about what had changed — and marking that by hand is work nobody does when
// the diff is in Git. Colour is what people reach for to make something stand
// out, which is not a meaning to preserve; the changed and deleted parts are
// marked from the diff instead.

export type InlineMark = 'bold' | 'italic' | 'code' | { readonly color: string };

/** `#abc` or `#aabbcc`. Nothing else is written into a document. */
export const COLOUR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

export interface InlineState {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
  /** The colour the selection already carries, if any. */
  readonly color: string | undefined;
}

export interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** Where the selection should be afterwards, so typing can continue. */
  readonly select: { readonly start: number; readonly end: number };
}

const WRAPPER: Readonly<Record<'bold' | 'italic' | 'code', string>> = {
  bold: '**', italic: '*', code: '`',
};

export function isColour(mark: InlineMark): mark is { readonly color: string } {
  return typeof mark === 'object';
}

/** What is already applied to the selection, for the toolbar's pressed state. */
export function inlineStateAt(text: string, start: number, end: number): InlineState {
  const trimmed = trim(text, start, end);
  return {
    bold: wrappedBy(text, trimmed, '**'),
    italic: wrappedBy(text, trimmed, '*') && !wrappedBy(text, trimmed, '**'),
    code: wrappedBy(text, trimmed, '`'),
    color: colourAround(text, trimmed),
  };
}

export function toggleInline(
  text: string, start: number, end: number, mark: InlineMark,
): Replacement {
  const span = trim(text, start, end);
  return isColour(mark)
    ? toggleColour(text, span, mark.color)
    : toggleWrapper(text, span, mark);
}

function toggleWrapper(
  text: string, span: Span, mark: 'bold' | 'italic' | 'code',
): Replacement {
  const marker = WRAPPER[mark];
  const inner = text.slice(span.start, span.end);

  // Italic has to ignore the inner `*` of a bold pair, or toggling italic on
  // bold text would eat one of its asterisks and leave the markup broken.
  const isBoldPair = mark === 'italic' && wrappedBy(text, span, '**');

  if (!isBoldPair && wrappedBy(text, span, marker)) {
    const start = span.start - marker.length;
    return {
      start, end: span.end + marker.length, text: inner,
      select: { start, end: start + inner.length },
    };
  }
  const wrapped = `${marker}${inner}${marker}`;
  return {
    start: span.start, end: span.end, text: wrapped,
    select: { start: span.start + marker.length, end: span.start + marker.length + inner.length },
  };
}

/**
 * A colour is written as a bracketed span, `[文字列]{color=#c62828}` — Pandoc's
 * notation, so the file still means something outside this product. Applying a
 * second colour replaces the first; a run of text has one colour.
 */
function toggleColour(text: string, span: Span, colour: string): Replacement {
  const inner = text.slice(span.start, span.end);
  const existing = colourAround(text, span);

  if (existing !== undefined) {
    const open = span.start - 1;
    const close = text.indexOf('}', span.end) + 1;
    if (existing.toLowerCase() === colour.toLowerCase()) {
      return {
        start: open, end: close, text: inner,
        select: { start: open, end: open + inner.length },
      };
    }
    const written = `[${inner}]{color=${colour}}`;
    return {
      start: open, end: close, text: written,
      select: { start: open + 1, end: open + 1 + inner.length },
    };
  }

  const written = `[${inner}]{color=${colour}}`;
  return {
    start: span.start, end: span.end, text: written,
    select: { start: span.start + 1, end: span.start + 1 + inner.length },
  };
}

interface Span { readonly start: number; readonly end: number }

/** Trailing spaces in a selection are the mouse's doing, not the author's. */
function trim(text: string, start: number, end: number): Span {
  let from = Math.min(start, end);
  let to = Math.max(start, end);
  while (from < to && /\s/.test(text[from] ?? '')) from++;
  while (to > from && /\s/.test(text[to - 1] ?? '')) to--;
  return { start: from, end: to };
}

function wrappedBy(text: string, span: Span, marker: string): boolean {
  return span.start >= marker.length
    && text.slice(span.start - marker.length, span.start) === marker
    && text.slice(span.end, span.end + marker.length) === marker;
}

/** The colour of a `[…]{color=…}` the selection sits exactly inside. */
function colourAround(text: string, span: Span): string | undefined {
  if (text[span.start - 1] !== '[') return undefined;
  const after = /^\]\{color\s*=\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\}/.exec(text.slice(span.end));
  return after?.[1];
}
