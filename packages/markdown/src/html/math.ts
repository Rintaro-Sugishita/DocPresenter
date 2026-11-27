// Formulas: `$…$` in a line, `$$…$$` on lines of their own — the notation
// Markdown Preview Enhanced reads, drawn with KaTeX as it does, so a document
// written for one reads the same in the other.
//
// What makes `$` a formula and not money: the opening `$` is followed by
// something that is not a space, the closing one is preceded by something that
// is not a space and is not followed by a digit. `$5 and $10` is two prices.
// `\$` is a dollar sign. Inside code, nothing is a formula.

import katex from 'katex';
import type { MarkdownIt, StateBlock, StateInline } from 'markdown-it';
import { escapeAttr, escapeHtml } from '@docpresenter/base';

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;

/**
 * A formula as HTML: KaTeX's own markup, in an element that keeps the TeX it
 * came from — a PDF or a slide draws it again from that. One KaTeX cannot
 * read is shown as its TeX, marked, rather than taking the page down.
 */
export function renderMath(tex: string, display: boolean): string {
  let inner: string;
  try {
    inner = katex.renderToString(tex, { displayMode: display, throwOnError: true, output: 'html', strict: 'ignore' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    inner = `<code class="dp-math-error" title="${escapeAttr(message)}">${escapeHtml(display ? `$$${tex}$$` : `$${tex}$`)}</code>`;
  }
  const tag = display ? 'div' : 'span';
  return `<${tag} class="dp-math${display ? ' dp-math-block' : ''}" data-tex="${escapeAttr(tex)}">${inner}</${tag}>`;
}

/** What a page adds under KaTeX's stylesheet, at no specificity so a theme can say otherwise. */
export const MATH_RULES = [
  ':where(.dp-math-block) { overflow-x: auto; overflow-y: hidden; }',
  ':where(.dp-math-error) { color: #b3261e; }',
].join('\n');

/**
 * How a formula is asked for as a picture, among the Mermaid drawings a
 * slide asks for: the TeX after this. No Mermaid source starts with it.
 */
export const MATH_PICTURE = '\u0001math\u0001';

/** Whether the text holds a formula's markup, so a page knows to carry KaTeX's style. */
export function hasMath(html: string): boolean {
  return html.includes('class="dp-math');
}

function inlineMath(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== DOLLAR) return false;
  // `$$` in a line is not this rule's: it is left as written.
  if (src.charCodeAt(pos + 1) === DOLLAR) return false;
  const first = src[pos + 1];
  if (first === undefined || /\s/.test(first)) return false;
  for (let at = pos + 1; at < posMax; at++) {
    const code = src.charCodeAt(at);
    if (code === BACKSLASH) { at++; continue; }
    // A formula in a line stays in it, and never runs into code: `$5 … `$x$``
    // is a price and some code, not a formula ending inside the code.
    if (code === 0x0a || code === 0x60) return false;
    if (code !== DOLLAR) continue;
    if (/\s/.test(src[at - 1] ?? ' ')) continue;
    if (/\d/.test(src[at + 1] ?? '')) continue;
    if (at === pos + 1) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = src.slice(pos + 1, at);
      token.markup = '$';
    }
    state.pos = at + 1;
    return true;
  }
  return false;
}

function blockMath(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const max = state.eMarks[startLine]!;
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  if (start + 2 > max || state.src.slice(start, start + 2) !== '$$') return false;
  const firstLine = state.src.slice(start + 2, max);
  // `$$ x $$` on one line.
  const closedHere = firstLine.trimEnd().endsWith('$$') && firstLine.trim().length >= 2;
  let next = startLine;
  let body: string;
  if (closedHere) {
    body = firstLine.trimEnd().slice(0, -2);
  } else {
    const lines = [firstLine];
    let closed = false;
    while (++next < endLine) {
      const from = state.bMarks[next]! + state.tShift[next]!;
      const to = state.eMarks[next]!;
      const line = state.src.slice(from, to);
      if (line.trimEnd().endsWith('$$')) {
        lines.push(line.trimEnd().slice(0, -2));
        closed = true;
        break;
      }
      lines.push(state.src.slice(state.bMarks[next]!, to));
    }
    if (!closed) return false;
    body = lines.join('\n');
  }
  if (silent) return true;
  state.line = next + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = body.trim();
  token.markup = '$$';
  token.map = [startLine, state.line];
  return true;
}

/** The plugin: `$…$` and `$$…$$`, drawn by KaTeX. */
export function math(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'math_inline', inlineMath);
  md.block.ruler.after('blockquote', 'math_block', blockMath, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules['math_inline'] = (tokens, index) => renderMath(tokens[index]!.content, false);
  md.renderer.rules['math_block'] = (tokens, index) => `${renderMath(tokens[index]!.content, true)}\n`;
}

/** A formula on lines of its own in some prose, by line, counted from 0. */
export interface DisplayMath {
  readonly from: number;
  /** Its last line, the one the closing `$$` is on. */
  readonly to: number;
  readonly tex: string;
}

/**
 * The `$$…$$` formulas in a run of prose, outside its code blocks — what a
 * slide shows as pictures. Read by lines, the way the page reads them.
 */
export function displayMath(text: string): DisplayMath[] {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
  const out: DisplayMath[] = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    const opens = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence !== undefined) {
      if (opens && trimmed.startsWith(fence)) fence = undefined;
      continue;
    }
    if (opens) { fence = opens[1]!; continue; }
    if (!trimmed.startsWith('$$')) continue;
    const rest = trimmed.slice(2);
    if (rest.trimEnd().endsWith('$$') && rest.trim().length >= 2) {
      out.push({ from: i, to: i, tex: rest.trimEnd().slice(0, -2).trim() });
      continue;
    }
    const body = [rest];
    let end = i + 1;
    for (; end < lines.length; end++) {
      const line = lines[end]!.trimEnd();
      if (line.endsWith('$$')) { body.push(line.slice(0, -2)); break; }
      body.push(lines[end]!);
    }
    if (end >= lines.length) continue;
    out.push({ from: i, to: end, tex: body.join('\n').trim() });
    i = end;
  }
  return out;
}
