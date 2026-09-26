// `[目立たせたい]{color=#c62828}` — Pandoc's bracketed span, borrowed rather
// than invented.
//
// Colour is the author's to choose. The earlier vocabulary of four meanings
// was built around marking what had changed, and marking that by hand is work
// nobody does when the diff is in Git; what people actually reach for colour
// for is to make something stand out, and that has no meaning to preserve.
//
// A class is still accepted, for a theme that defines named colours, and files
// written against the earlier vocabulary keep rendering.

import type { MarkdownIt, StateInline } from 'markdown-it';

const TOKENS = new Set(['changed', 'pending', 'disabled', 'removed']);
const CLASS = /^\{\.([a-z0-9-]+)\}/;
/** `{color=#c62828}`; the hex forms only, so nothing else reaches the style. */
const COLOUR = /^\{color\s*=\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\}/;

export function bracketedSpan(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'dp_span', rule);
}

function rule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;

  const close = findClose(state.src, state.pos, state.posMax);
  if (close < 0) return false;

  const rest = state.src.slice(close + 1, state.posMax);
  const colour = COLOUR.exec(rest);
  const named = CLASS.exec(rest);
  const token = named?.[1];
  const matched = colour ?? (token !== undefined && TOKENS.has(token) ? named : undefined);
  if (!matched) return false;

  if (!silent) {
    const open = state.push('dp_span_open', 'span', 1);
    if (colour) open.attrSet('style', `color:${colour[1]}`);
    else open.attrSet('class', `dp-text-${token}`);
    state.md.inline.parse(
      state.src.slice(state.pos + 1, close), state.md, state.env, state.tokens,
    );
    state.push('dp_span_close', 'span', -1);
  }
  state.pos = close + 1 + matched[0].length;
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
