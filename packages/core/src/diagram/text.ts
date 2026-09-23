// Text measurement for diagram layout. A diagram has to size its shapes before
// any font is loaded — the layout is computed in the browser, in Node and in
// the PPTX writer alike — so the width is estimated from the character classes
// rather than measured. The estimate is deliberately slightly generous: a box
// a little too wide is invisible, a box too narrow clips its label.

/** Full-width ranges: CJK, kana, full-width forms and CJK punctuation. */
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/** Width of one character in em. */
function charWidth(char: string): number {
  if (WIDE.test(char)) return 1;
  if (/[iIlj.,:;'!|]/.test(char)) return 0.3;
  if (/[A-Z@%&]/.test(char)) return 0.68;
  return 0.55;
}

export function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const char of text) em += charWidth(char);
  return em * fontSize;
}

/** Characters Japanese typesetting forbids at the start of a line. */
const NO_LINE_START = /[、。，．）」』】〕〉》’”ー〜！？：；ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;

/**
 * Breaks a label into lines that fit `maxWidth`. Japanese has no spaces, so a
 * wide character may start a new line anywhere; a run of narrow characters is
 * kept together as a word. A character that may not open a line stays on the
 * line it belongs to even when that line then runs a little long — the
 * alternative reads as broken Japanese.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    let width = 0;
    const flush = (): void => { lines.push(current.replace(/\s+$/, '')); current = ''; width = 0; };
    for (const token of tokenize(paragraph)) {
      const tokenWidth = textWidth(token, fontSize);
      const mayBreak = !NO_LINE_START.test(token);
      if (current !== '' && mayBreak && width + tokenWidth > maxWidth) flush();
      if (token === ' ' && current === '') continue;
      current += token;
      width += tokenWidth;
    }
    flush();
  }
  return lines;
}

/** A wide character is its own token; narrow characters clump into words. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let word = '';
  for (const char of text) {
    if (WIDE.test(char) || char === ' ') {
      if (word !== '') { tokens.push(word); word = ''; }
      tokens.push(char);
    } else {
      word += char;
    }
  }
  if (word !== '') tokens.push(word);
  return tokens;
}
