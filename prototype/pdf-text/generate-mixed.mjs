// Two pre-subsetted faces in one document, which is what a theme that
// distinguishes headings from body text actually needs.
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, writeFileSync } from 'node:fs';

const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const sans  = await pdf.embedFont(readFileSync('sans-sub.otf'),  { subset: false });
const serif = await pdf.embedFont(readFileSync('serif-sub.otf'), { subset: false });

const page = pdf.addPage([595, 220]);
page.drawText('認証機能 設計書',            { x: 40, y: 170, size: 20, font: sans  });
page.drawText('見出しはゴシック、本文は明朝。', { x: 40, y: 130, size: 14, font: serif });
page.drawText('𠮷野・髙﨑 ABC 123',          { x: 40, y: 100, size: 14, font: serif });
page.drawText('𠮷野・髙﨑 ABC 123',          { x: 40, y:  70, size: 14, font: sans  });

const bytes = await pdf.save();
writeFileSync('mixed.pdf', bytes);
console.log(`mixed.pdf  ${(bytes.length/1024).toFixed(1)} KB（2 書体を埋め込み）`);
