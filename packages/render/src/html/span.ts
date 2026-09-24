// `[要確認]{.pending}` — Pandoc's bracketed span, borrowed rather than
// invented. Only the fixed meaning tokens are accepted: an arbitrary class
// would let a document carry styling the theme has never seen, and a colour
// nobody can print or read back.

import type { MarkdownIt, StateInline } from 'markdown-it';

const TOKENS = new Set(['changed', 'pending', 'disabled', 'removed']);
const ATTRIBUTES = /^\{\.([a-z0-9-]+)\}/;

export function bracketedSpan(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'dp_span', rule);
}

function rule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;

  const close = findClose(state.src, state.pos, state.posMax);
  if (close < 0) return false;

  const attributes = ATTRIBUTES.exec(state.src.slice(close + 1, state.posMax));
  const token = attributes?.[1];
  if (!attributes || token === undefined || !TOKENS.has(token)) return false;

  if (!silent) {
    state.push('dp_span_open', 'span', 1).attrSet('class', `dp-text-${token}`);
    state.md.inline.parse(
      state.src.slice(state.pos + 1, close), state.md, state.env, state.tokens,
    );
    state.push('dp_span_close', 'span', -1);
  }
  state.pos = close + 1 + attributes[0].length;
  return true;
}

/** The matching `]`, skipping escapes and nested brackets. */
function findClose(source: string, open: number, max: number): number {
  let depth = 0;
  for (let i = open; i < max; i++) {
    const char = source[i];
    if (char === '\\') { i++; continue; }
    if (char === '[') depth++;
    else if (char === ']' && --depth === 0) return i;
  }
  return -1;
}
