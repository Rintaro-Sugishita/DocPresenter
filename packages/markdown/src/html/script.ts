// `x^2^` and `H~2~O` — Pandoc's superscript and subscript.
//
// `~~` is strikethrough, which markdown-it already reads (and reads first), so
// a single `~` reaching here is subscript. As in Pandoc, the words inside may
// not hold a bare space — `\ ` spells one — so `3^2 and 4^2` stays as written.

import type { MarkdownIt, StateInline } from 'markdown-it';

export function superSub(md: MarkdownIt): void {
  md.inline.ruler.after('emphasis', 'dp_sup', rule(0x5e /* ^ */, 'sup'));
  md.inline.ruler.after('emphasis', 'dp_sub', rule(0x7e /* ~ */, 'sub'));
}

/** A space not spelt `\ `. */
const BARE_SPACE = /(^|[^\\])(\\\\)*\s/;
const ESCAPED = /\\([ \\!"#$%&'()*+,./:;<=>?@[\]^_`{|}~-])/g;

function rule(marker: number, tag: 'sup' | 'sub') {
  return (state: StateInline, silent: boolean): boolean => {
    const start = state.pos;
    const max = state.posMax;
    if (silent || state.src.charCodeAt(start) !== marker) return false;
    // `~~` is strikethrough's, open or not.
    if (marker === 0x7e && (state.src.charCodeAt(start + 1) === 0x7e || state.src.charCodeAt(start - 1) === 0x7e)) {
      return false;
    }
    if (start + 2 > max) return false;
    let end = start + 1;
    while (end < max && state.src.charCodeAt(end) !== marker) end += state.src[end] === '\\' ? 2 : 1;
    if (end >= max || end === start + 1) return false;
    const content = state.src.slice(start + 1, end);
    if (BARE_SPACE.test(content)) return false;
    state.push(`dp_${tag}_open`, tag, 1);
    const text = state.push('text', '', 0);
    text.content = content.replace(ESCAPED, '$1');
    state.push(`dp_${tag}_close`, tag, -1);
    state.pos = end + 1;
    return true;
  };
}
