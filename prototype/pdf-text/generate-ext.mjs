// Same as generate.mjs but with the patched font, isolating whether a
// supplementary-plane codepoint survives encoding and the ToUnicode map.
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, writeFileSync } from 'node:fs';

const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const font = await pdf.embedFont(readFileSync('ipag-ext.ttf'), { subset: true });
const page = pdf.addPage([595, 200]);
page.drawText('髙﨑・𠮷野・彅（環境依存文字）', { x: 40, y: 120, size: 16, font });
page.drawText('𠮷野家とサロゲートペア', { x: 40, y: 80, size: 16, font });
writeFileSync('out-ext.pdf', await pdf.save());
console.log('out-ext.pdf を生成');
