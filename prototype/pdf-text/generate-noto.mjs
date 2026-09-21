// Repeats the extraction check with Noto Sans CJK JP, which covers far more of
// the character set Japanese design documents need than IPA Gothic does.
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, writeFileSync } from 'node:fs';

const FONT = readFileSync('NotoSansCJKjp-Regular.otf');   // JP face extracted from the .ttc

const LINES = [
  '認証機能 設計書',
  '𠮷野・𠮟責・𩸽（CJK 拡張 B）',
  '髙﨑・彅・俱・剝（環境依存文字・JIS 第 3 水準）',
  '㋿ 元年 ①②③ ＡＢＣ １２３ ※§¶',
  'パスワードは 8 文字以上、英大文字・小文字・数字・記号を各 1 文字以上。',
];

for (const subset of [true, false]) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(FONT, { subset });
  const page = pdf.addPage([595, 300]);
  let y = 250;
  for (const line of LINES) { page.drawText(line, { x: 40, y, size: 14, font }); y -= 34; }
  const bytes = await pdf.save();
  const name = `noto-${subset ? 'subset' : 'full'}.pdf`;
  writeFileSync(name, bytes);
  console.log(`${name.padEnd(20)} ${(bytes.length / 1024).toFixed(1)} KB`);
}
