// Checks whether missing glyphs can be detected before writing the PDF, since
// a character the font lacks renders as a box and vanishes from extracted text.
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';

const font = fontkit.create(readFileSync('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'));
const text = '髙﨑・𠮷野・彅（環境依存文字）ｱ㈱㋿🙂';
const missing = [];
for (const ch of text) {                       // iterates by code point, not UTF-16 unit
  if (!font.hasGlyphForCodePoint(ch.codePointAt(0))) missing.push(ch);
}
console.log('検査文字列:', text);
console.log('欠字:', missing.length ? missing.join(' ') : 'なし');
console.log('  → 書き出し前に検出できる:', missing.length > 0 ? 'はい' : '(欠字なし)');
