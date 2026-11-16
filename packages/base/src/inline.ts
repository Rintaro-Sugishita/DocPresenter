// Inline formatting: bold, italic, code, strikethrough, superscript,
// subscript, underline and colour.
//
// The four added on 2026-11-13 are written as Pandoc writes them, beside the
// colour that already was: `~~消す~~`, `x^2^`, `H~2~O`, `[下線]{.underline}`.
// Pandoc does not allow a bare space inside `^…^` or `~…~`, so a space there
// is written `\ `, which is what keeps `3^2 and 4^2` from reading as one.
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

export type InlineMark =
  | 'bold' | 'italic' | 'code' | 'strike' | 'sup' | 'sub' | 'underline' | { readonly color: string };

/** `#abc` or `#aabbcc`. Nothing else is written into a document. */
export const COLOUR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

export interface InlineState {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
  readonly strike: boolean;
  readonly sup: boolean;
  readonly sub: boolean;
  readonly underline: boolean;
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
  const { level } = emphasisAround(text, trimmed);
  return {
    bold: level >= 2,
    italic: level === 1 || level === 3,
    code: codeAround(text, trimmed) !== undefined,
    strike: wrapAround(text, trimmed, '~~') !== undefined,
    sup: wrapAround(text, trimmed, '^') !== undefined,
    sub: wrapAround(text, trimmed, '~') !== undefined,
    underline: underlineAround(text, trimmed) !== undefined,
    color: colourAround(text, trimmed),
  };
}

export function toggleInline(
  text: string, start: number, end: number, mark: InlineMark,
): Replacement {
  const span = trim(text, start, end);
  if (isColour(mark)) return toggleColour(text, span, mark.color);
  switch (mark) {
    case 'code': return toggleCode(text, span);
    case 'strike': return toggleWrap(text, span, '~~');
    case 'sup': return toggleWrap(text, span, '^');
    case 'sub': return toggleWrap(text, span, '~');
    case 'underline': return toggleUnderline(text, span);
    default: return toggleEmphasis(text, span, mark);
  }
}

/**
 * The emphasis a selection has, read from the marks around its words: those
 * just outside it and those it took in with the words, since selecting `*語*`
 * and selecting `語` inside it mean the same thing. `*` is italic, `**` bold,
 * `***` both; `_` counts the same way. `content` is the words without marks.
 */
function emphasisAround(text: string, span: Span): { level: number; content: Span; char: string } {
  let { start, end } = span;
  const char = text[start] === '_' || text[start - 1] === '_' ? '_' : '*';
  // The marks the selection took in with the words.
  while (start < end && text[start] === char) start++;
  while (end > start && text[end - 1] === char) end--;
  if (start === end) {
    // Nothing but marks (or nothing): the cursor sits between them.
    start = end = Math.min(span.end, Math.max(span.start, (span.start + span.end) >> 1));
  }
  let before = 0;
  while (before < 3 && text[start - before - 1] === char) before++;
  let after = 0;
  while (after < 3 && text[end + after] === char) after++;
  return { level: Math.min(before, after), content: { start, end }, char };
}

/**
 * Bold and italic are two switches on one run of marks: pressing one flips it
 * and leaves the other as it was, so italic on bold words makes `***` and
 * italic again takes it back to `**` — never a second pair of `*` that would
 * read as bold.
 */
function toggleEmphasis(text: string, span: Span, mark: 'bold' | 'italic'): Replacement {
  const { level, content, char } = emphasisAround(text, span);
  const next = level ^ (mark === 'bold' ? 2 : 1);
  const inner = text.slice(content.start, content.end);
  const from = content.start - level;
  const marks = char.repeat(next);
  return {
    start: from, end: content.end + level, text: `${marks}${inner}${marks}`,
    select: { start: from + next, end: from + next + inner.length },
  };
}

/** The code span a selection is in or is: its words, without the backticks. */
function codeAround(text: string, span: Span): Span | undefined {
  const marker = WRAPPER.code;
  if (wrappedBy(text, span, marker)) return span;
  const inner = text.slice(span.start, span.end);
  if (inner.length >= 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
    return { start: span.start + 1, end: span.end - 1 };
  }
  return undefined;
}

function toggleCode(text: string, span: Span): Replacement {
  const marker = WRAPPER.code;
  const inside = codeAround(text, span);
  if (inside) {
    const inner = text.slice(inside.start, inside.end);
    const start = inside.start - marker.length;
    return { start, end: inside.end + marker.length, text: inner, select: { start, end: start + inner.length } };
  }
  const inner = text.slice(span.start, span.end);
  return {
    start: span.start, end: span.end, text: `${marker}${inner}${marker}`,
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

/**
 * The words a `~~`, `^` or `~` pair holds, when the selection is those words or
 * the words with the marks. A single `~` is subscript only when it is not half
 * of a `~~`.
 */
function wrapAround(text: string, span: Span, marker: '~~' | '^' | '~'): Span | undefined {
  const lone = (at: number): boolean => marker !== '~' || (text[at] !== '~');
  if (wrappedBy(text, span, marker) && lone(span.start - marker.length - 1) && lone(span.end + marker.length)) {
    return span;
  }
  const inner = text.slice(span.start, span.end);
  if (inner.length > marker.length * 2 && inner.startsWith(marker) && inner.endsWith(marker)
    && (marker !== '~' || (!inner.startsWith('~~') && !inner.endsWith('~~')))) {
    return { start: span.start + marker.length, end: span.end - marker.length };
  }
  return undefined;
}

/**
 * Strikethrough, superscript and subscript: one pair of marks around the
 * words, put on or taken off. Inside `^…^` and `~…~` a space is `\ `.
 */
function toggleWrap(text: string, span: Span, marker: '~~' | '^' | '~'): Replacement {
  const spaced = marker !== '~~';
  const inside = wrapAround(text, span, marker);
  if (inside) {
    const held = text.slice(inside.start, inside.end);
    const inner = spaced ? held.replace(/\\ /g, ' ') : held;
    const start = inside.start - marker.length;
    return { start, end: inside.end + marker.length, text: inner, select: { start, end: start + inner.length } };
  }
  const plain = text.slice(span.start, span.end);
  const inner = spaced ? plain.replace(/(?<!\\) /g, '\\ ') : plain;
  return {
    start: span.start, end: span.end, text: `${marker}${inner}${marker}`,
    select: { start: span.start + marker.length, end: span.start + marker.length + inner.length },
  };
}

const UNDERLINE = /^\]\{\.underline\}/;

/** The words of a `[…]{.underline}` the selection is, or is exactly inside. */
function underlineAround(text: string, span: Span): Span | undefined {
  if (text[span.start - 1] === '[' && UNDERLINE.test(text.slice(span.end))) return span;
  const inner = text.slice(span.start, span.end);
  if (inner.startsWith('[') && inner.endsWith(']{.underline}')) {
    return { start: span.start + 1, end: span.end - ']{.underline}'.length };
  }
  return undefined;
}

/** Underline is a bracketed span with Pandoc's class for it, as colour is a span with a colour. */
function toggleUnderline(text: string, span: Span): Replacement {
  const inside = underlineAround(text, span);
  if (inside) {
    const inner = text.slice(inside.start, inside.end);
    const start = inside.start - 1;
    return {
      start, end: inside.end + ']{.underline}'.length, text: inner, select: { start, end: start + inner.length },
    };
  }
  const inner = text.slice(span.start, span.end);
  return {
    start: span.start, end: span.end, text: `[${inner}]{.underline}`,
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
