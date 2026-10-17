// How wide text is in a monospaced editor, for lining up columns of source.

/** Columns a character occupies in a monospaced grid: two for a wide (CJK) character, one otherwise. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(char)
      ? 2 : 1;
  }
  return width;
}

/** The text followed by spaces up to the width, measured as {@link displayWidth} measures it. */
export function padToWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}
