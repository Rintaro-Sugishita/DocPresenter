// Review comments on the real sample PDF, end to end.
//
// The annotations are placed where pdf.js — an independent reader — says the
// words are, the way a viewer places a highlight over a text selection, and
// written into the PDF as viewers write them. Then the PDF is read back and
// each comment must land on the source bytes of what was marked.
//
// Usage: node tools/check-pdf-review.mjs   (after node tools/build.mjs --in sample)
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { appendReplies, appendReview, planImport, readReviewPdf, resolveAnnotations } from '../packages/pdf/dist/index.js';
import { parse } from 'yaml';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const SOURCE = 'out/build/docs/auth-design.pdf';
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
// The PDF also carries the review so far (ours); only what was added here counts.
const resolved = planImport(resolveAnnotations(review), review.map?.written).fresh;
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

// --- 往復: PDF に載せた指摘と回答、それへの顧客の返信 ------------------------------------
//
// The PDF as built carries the sample's review so far (reviews/*.review.yml).
// A customer replies to one comment the way a viewer does — a note with IRT
// pointing at it — and the import must put the reply under that comment and
// take nothing of ours back in.
const built = await PDFDocument.load(bytes);
const ours = [];
built.getPages().forEach((page, index) => {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  for (let i = 0; annots && i < annots.size(); i += 1) {
    const dict = built.context.lookup(annots.get(i), PDFDict);
    const name = dict.get(PDFName.of('NM'))?.decodeText?.() ?? '';
    if (name.startsWith('dp-review:')) ours.push({ page: index, ref: annots.get(i), dict, name, subtype: String(dict.get(PDFName.of('Subtype'))) });
  }
});
// The sample's own review file has three comments, one answered; any other
// review file in the sample (one made while trying things) adds to that.
const customer = ['#1', '#2', '#3'].map(tail => `dp-review:reviews/2026-10-01-customer.review.yml${tail}`);
check('PDF にはサンプルの指摘が載っている', customer.every(name => ours.some(one => one.name === name)),
  ours.map(one => `p.${one.page + 1} ${one.subtype} ${one.name.replace('dp-review:reviews/', '')}`).join(', '));
// The answer is in the comment's own text: Edge shows no thread under it.
const answered = ours.find(one => one.name.endsWith('customer.review.yml#2'));
const answeredText = answered?.dict.get(PDFName.of('Contents'))?.decodeText() ?? '';
check('回答は指摘の注釈そのものの文に入っている（返信のスレッドを出さない閲覧ソフトでも読める）',
  answeredText.includes('【回答】intra グループに api を含め') && answeredText.includes('【状態】'), answeredText.replace(/\n+/g, ' / '));
const target = ours.find(one => one.name.endsWith('#3'));
check('語のある指摘はハイライトとして載る', target?.subtype === '/Highlight', target?.subtype);
// Edge's way of answering: written on below our text, in the same annotation.
const first = ours.find(one => one.name.endsWith('customer.review.yml#1'));
const firstText = first.dict.get(PDFName.of('Contents')).decodeText();
first.dict.set(PDFName.of('Contents'), PDFHexString.fromText(`${firstText}\r\n\r\n12 文字で了承します`));
// Acrobat's way: a reply threaded under ours.
const page = built.getPage(target.page);
page.node.lookup(PDFName.of('Annots'), PDFArray).push(built.context.register(built.context.obj({
  Type: 'Annot', Subtype: 'Text', IRT: target.ref, Rect: [10, 10, 28, 28],
  Contents: PDFHexString.fromText('24 時間での自動解除で合意します'), T: PDFHexString.fromText('発注者'),
  NM: PDFHexString.fromText('check-reply-1'),
})));
const back = await built.save();
writeFileSync('out/auth-design-replied.pdf', back);
const returned = await readReviewPdf(back);
const plan = planImport(resolveAnnotations(returned), returned.map?.written);
check('載せたものは取り込まない', plan.ours === ours.length && plan.fresh.length === 0, `ours ${plan.ours} / fresh ${plan.fresh.length}`);
const replies = plan.replies.get('reviews/2026-10-01-customer.review.yml') ?? [];
check('スレッドの返信も、注釈への書き足しも、元の指摘の番号に向かう',
  replies.length === 2 && replies.some(one => one.id === 3 && one.body === '24 時間での自動解除で合意します')
  && replies.some(one => one.id === 1 && one.body === '12 文字で了承します'), JSON.stringify(replies.map(one => [one.id, one.body])));
const reviewText = readFileSync('sample/reviews/2026-10-01-customer.review.yml', 'utf8').replace(/\r\n/g, '\n');
const placed = appendReplies(reviewText, replies);
const third = parse(placed.text).comments.find(c => c.id === 3);
const firstEntry = parse(placed.text).comments.find(c => c.id === 1);
check('返信は指摘の下の replies: に入る', third?.replies?.[0]?.body === '24 時間での自動解除で合意します' && third.replies[0].author === '発注者'
  && firstEntry?.replies?.[0]?.body === '12 文字で了承します', JSON.stringify([third?.replies, firstEntry?.replies]));
check('　前の行は変わらない', reviewText.split('\n').every(line => placed.text.split('\n').includes(line)));
check('　二度は入らない', appendReplies(placed.text, replies).added === 0);
