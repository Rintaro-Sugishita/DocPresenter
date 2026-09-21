// Embeds the pre-subsetted font whole, so pdf-lib's CFF subsetter is not used.
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, writeFileSync } from 'node:fs';

const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const font = await pdf.embedFont(readFileSync('noto-sub.otf'), { subset: false });
const page = pdf.addPage([595, 300]);
const LINES = [
  '認証機能 設計書',
  '𠮷野・𠮟責・𩸽（CJK 拡張 B）',
  '髙﨑・彅・俱・剝（環境依存文字・JIS 第 3 水準）',
  '㋿ 元年 ①②③ ＡＢＣ １２３ ※§¶',
  'パスワードは 8 文字以上、英大文字・小文字・数字・記号を各 1 文字以上。',
];
let y = 250;
for (const l of LINES) { page.drawText(l, { x: 40, y, size: 14, font }); y -= 34; }
const bytes = await pdf.save();
writeFileSync('noto-presub.pdf', bytes);
console.log(`noto-presub.pdf  ${(bytes.length/1024).toFixed(1)} KB`);
