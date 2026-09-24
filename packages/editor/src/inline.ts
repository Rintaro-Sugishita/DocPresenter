// Inline formatting: bold, italic, code and the meaning tokens.
//
// These work on the text of one block, in string indices, because that is what
// a text box hands you. The byte-range discipline applies where it matters —
// the block is written back to the file as one byte-range replacement — and
// forcing byte arithmetic in here as well would only obscure the logic.
//
// Colour is not offered. A design document is printed, read by people who see
// colour differently, and read by machines; `#c00` says nothing to any of them.
// The four meaning tokens the tables already use say what the colour meant.

/** The meaning tokens, fixed. Same vocabulary as a table's fills. */
export const TOKENS = ['changed', 'pending', 'disabled', 'removed'] as const;
export type Token = (typeof TOKENS)[number];

export type InlineMark = 'bold' | 'italic' | 'code' | Token;

export interface InlineState {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
  readonly token: Token | undefined;
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

export function isToken(mark: InlineMark): mark is Token {
  return (TOKENS as readonly string[]).includes(mark);
}

/** What is already applied to the selection, for the toolbar's pressed state. */
export function inlineStateAt(text: string, start: number, end: number): InlineState {
  const trimmed = trim(text, start, end);
  return {
    bold: wrappedBy(text, trimmed, '**'),
    italic: wrappedBy(text, trimmed, '*') && !wrappedBy(text, trimmed, '**'),
    code: wrappedBy(text, trimmed, '`'),
    token: tokenAround(text, trimmed),
  };
}

export function toggleInline(
  text: string, start: number, end: number, mark: InlineMark,
): Replacement {
  const span = trim(text, start, end);
  return isToken(mark) ? toggleToken(text, span, mark) : toggleWrapper(text, span, mark);
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
 * A token is written as a bracketed span, `[検討中]{.pending}` — Pandoc's
 * notation, so the file still means something outside this product. Applying a
 * second token replaces the first: a run of text means one thing at a time.
 */
function toggleToken(text: string, span: Span, token: Token): Replacement {
  const existing = tokenAround(text, span);
  if (existing !== undefined) {
    const open = span.start - 1;
    const close = text.indexOf('}', span.end) + 1;
    const inner = text.slice(span.start, span.end);
    if (existing === token) {
      return {
        start: open, end: close, text: inner,
        select: { start: open, end: open + inner.length },
      };
    }
    const written = `[${inner}]{.${token}}`;
    return {
      start: open, end: close, text: written,
      select: { start: open + 1, end: open + 1 + inner.length },
    };
  }
  const inner = text.slice(span.start, span.end);
  const written = `[${inner}]{.${token}}`;
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

/** The token of a `[…]{.token}` the selection sits exactly inside. */
function tokenAround(text: string, span: Span): Token | undefined {
  if (text[span.start - 1] !== '[') return undefined;
  const after = /^\]\{\.([a-z0-9-]+)\}/.exec(text.slice(span.end));
  const name = after?.[1];
  return name !== undefined && (TOKENS as readonly string[]).includes(name)
    ? (name as Token)
    : undefined;
}
