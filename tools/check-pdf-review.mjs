// Review comments on the real sample PDF, end to end.
//
// The annotations are placed where pdf.js — an independent reader — says the
// words are, the way a viewer places a highlight over a text selection, and
// written into the PDF as viewers write them. Then the PDF is read back and
// each comment must land on the source bytes of what was marked.
//
// Usage: node tools/check-pdf-review.mjs   (after node tools/build.mjs --in sample)
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { appendReview, readReviewPdf, resolveAnnotations } from '../packages/pdf/dist/index.js';
import { parse } from 'yaml';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const SOURCE = 'out/build/auth-design.pdf';
const bytes = new Uint8Array(readFileSync(SOURCE));

/** Where pdf.js says a phrase is printed: page, and its box in PDF space. */
async function locate(phrase) {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    for (const item of (await page.getTextContent()).items) {
      const at = item.str.indexOf(phrase);
      if (at < 0) continue;
      // Within the run, by the share of its width the characters before take
      // up — full-width characters an em, the rest half of one.
      const widthOf = text => [...text].reduce((sum, c) => sum + (c.codePointAt(0) > 0xff ? 1 : 0.55), 0);
      const unit = item.width / widthOf(item.str);
      const x0 = item.transform[4] + widthOf(item.str.slice(0, at)) * unit;
      const x1 = x0 + widthOf(phrase) * unit;
      const size = Math.hypot(item.transform[2], item.transform[3]);
      const y = item.transform[5];
      return { page: n, x0, x1, bottom: y - size * 0.2, top: y + size * 0.85 };
    }
  }
  throw new Error(`not printed: ${phrase}`);
}

const marks = [
  { phrase: 'ロックの解除は', body: '24 時間での自動解除も検討したい', file: 'docs/auth-design.md' },
  { phrase: '8 文字以上', body: '12 文字に変えてください', file: 'docs/auth-design/screen-items.table' },
];
const pdf = await PDFDocument.load(bytes);
const added = new Map();
for (const mark of marks) {
  const at = await locate(mark.phrase);
  const annotation = pdf.context.obj({
    Type: 'Annot', Subtype: 'Highlight',
    Rect: [at.x0, at.bottom, at.x1, at.top],
    QuadPoints: [at.x0, at.top, at.x1, at.top, at.x0, at.bottom, at.x1, at.bottom],
    Contents: PDFHexString.fromText(mark.body), T: PDFHexString.fromText('発注者'), NM: PDFHexString.fromText(`check-${mark.phrase}`),
    M: PDFString.of('D:20261008100000+09\'00\''),
  });
  const list = added.get(at.page) ?? [];
  list.push(pdf.context.register(annotation));
  added.set(at.page, list);
}
// A sticky note in the margin beside the first paragraph of page 5.
added.set(5, [...(added.get(5) ?? []), pdf.context.register(pdf.context.obj({
  Type: 'Annot', Subtype: 'Text', Rect: [20, 842 - 360, 38, 842 - 342],
  Contents: PDFHexString.fromText('この段落は誰の管理か'), T: PDFHexString.fromText('発注者'),
}))]);
for (const [n, refs] of added) pdf.getPage(n - 1).node.set(PDFName.of('Annots'), pdf.context.obj(refs));
const annotated = await pdf.save();
writeFileSync('out/auth-design-annotated.pdf', annotated);

const review = await readReviewPdf(annotated);
check('PDF から対応表とコミットが読める', review.map !== undefined && /^[0-9a-f]{40}$/.test(review.commit ?? ''), review.commit);
const resolved = resolveAnnotations(review);
check('注釈はすべて読める', resolved.length === 3, `${resolved.length} 件`);
for (const mark of marks) {
  const one = resolved.find(r => r.annotation.body === mark.body);
  check(`「${mark.phrase}」は ${mark.file} のその語を指す`,
    one?.precision === 'text' && one.anchor?.file === mark.file && one.anchor.quote === mark.phrase,
    one ? `${one.precision} ${one.anchor?.file} 「${one.anchor?.quote}」` : 'なし');
  const source = readFileSync(`sample/${mark.file}`, 'utf8').replace(/\r\n/g, '\n');
  const start = Buffer.byteLength(source.slice(0, source.indexOf(mark.phrase)));
  check('　バイト範囲は今のファイルのその語と同じ', one?.anchor?.start === start && one.anchor.end === start + Buffer.byteLength(mark.phrase),
    `${one?.anchor?.start}–${one?.anchor?.end} / ${start}`);
}
const note = resolved.find(r => r.annotation.kind === 'Text');
check('余白の付箋は、隣の段落を指す', note?.precision === 'block' && note.anchor?.quote.includes('認証 API は社内ネットワーク'),
  `${note?.precision} 「${note?.anchor?.quote.slice(0, 30)}」`);

const { text } = appendReview(undefined, resolved, {
  round: 'check', pdf: 'out/auth-design-annotated.pdf', document: review.map.document, commit: review.commit, clean: review.map.clean,
});
const yaml = parse(text);
check('レビューファイルとして読める', yaml.comments.length === 3 && yaml.comments.every(c => c.anchor.commit === review.commit));
