// The review going round through the PDF: the comments and answers written
// into it, a customer's reply taken back under the comment it answers, and
// nothing of ours taken back as new.

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from 'pdf-lib';
import { byteLength } from '@docpresenter/base';
import {
  appendReplies, planImport, readReviewPdf, resolveAnnotations, writePdf, type PagePlan, type ReviewPdfNote,
} from '../src/index.js';

const DOC = '# Design\n\nThe login screen locks after five failures.\nUnlock is manual only.\n';
const at = (piece: string) => {
  const start = byteLength(DOC.slice(0, DOC.indexOf(piece)));
  return { start, end: start + byteLength(piece) };
};
const prose = at('The login screen locks after five failures.\nUnlock is manual only.');
const PLAN: PagePlan = {
  width: 300, height: 400,
  pages: [{ items: [
    { kind: 'text', text: 'The login screen locks after five failures.', x: 50, y: 100, size: 10,
      bold: false, italic: false, family: 'body', colour: '#000000', span: prose },
  ] }],
};
const NOTES: ReviewPdfNote[] = [{
  key: 'dp-review:reviews/r1.review.yml#3', file: 'docs/a.md', ...at('five failures'),
  body: 'Make it ten', status: 'open', author: 'Customer',
  replies: [{ key: 'dp-review:reviews/r1.review.yml#3/answer', body: 'Changed to ten in 1.3' }],
}];

const REVIEW = [
  'round: "first"', 'via: pdf', '', 'comments:',
  '  - id: 3', '    anchor:', '      file: docs/a.md', '    body: "Make it ten"', '    status: open', '',
  '  - id: 4', '    body: "Other"', '    status: open', '    replies:', '      - body:   "earlier"', '        annotation: "x-1"', '',
].join('\n');

/** The PDF a customer is sent: the document, with the review so far on it. */
const sent = async () => (await writePdf(PLAN, {
  fonts: {} as never,
  review: { document: 'docs/a.md', commit: 'abc1234', clean: true, files: { 'docs/a.md': DOC }, notes: NOTES, locale: 'ja' },
})).bytes;

/** Every annotation dict on the first page. */
async function annotations(bytes: Uint8Array): Promise<PDFDict[]> {
  const pdf = await PDFDocument.load(bytes);
  const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  return Array.from({ length: annots.size() }, (_, i) => pdf.context.lookup(annots.get(i), PDFDict));
}
const textOf = (dict: PDFDict, key: string) => (dict.get(PDFName.of(key)) as PDFHexString | undefined)?.decodeText();

describe('PDF に載せる指摘と回答', () => {
  // Edge shows an annotation's own text and no thread under it, so the answer
  // is in the comment's text: one annotation per comment, readable anywhere.
  it('指摘はその語のハイライトとして載り、状態と回答はその中に書かれる', async () => {
    const all = await annotations(await sent());
    expect(all).toHaveLength(1);
    const [highlight] = all;
    expect(highlight!.get(PDFName.of('Subtype'))).toEqual(PDFName.of('Highlight'));
    expect(textOf(highlight!, 'NM')).toBe('dp-review:reviews/r1.review.yml#3');
    expect(textOf(highlight!, 'Contents')).toBe('Make it ten\n\n【状態】未対応\n\n【回答】Changed to ten in 1.3');
    expect(textOf(highlight!, 'T')).toBe('Customer');
    expect(textOf(highlight!, 'Subj')).toBe('未対応');
  });

  it('そのまま取り込むと、載せたものは何も入らない', async () => {
    const review = await readReviewPdf(await sent());
    const plan = planImport(resolveAnnotations(review), review.map?.written);
    expect(plan.ours).toBe(1);
    expect(plan.fresh).toEqual([]);
    expect(plan.replies.size).toBe(0);
  });
});

describe('顧客の返信', () => {
  /**
   * The PDF as it comes back: one reply the way Acrobat threads it (a note
   * pointing at ours), one the way Edge allows (written on below our text in
   * the same annotation), and one new comment.
   */
  async function returned(): Promise<Uint8Array> {
    const pdf = await PDFDocument.load(await sent());
    const page = pdf.getPage(0);
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
    const parent = annots.get(0) as PDFRef;
    const ours = pdf.context.lookup(parent, PDFDict);
    const wrote = (ours.get(PDFName.of('Contents')) as PDFHexString).decodeText();
    // A viewer saves the text with its own line breaks; that alone is no reply.
    ours.set(PDFName.of('Contents'), PDFHexString.fromText(`${wrote.replace(/\n/g, '\r\n')}\r\n\r\n了解です。10 回で確定`));
    annots.push(pdf.context.register(pdf.context.obj({
      Type: 'Annot', Subtype: 'Text', IRT: parent, Rect: [0, 0, 10, 10],
      Contents: PDFHexString.fromText('スレッドでの返信'), T: PDFHexString.fromText('発注者'),
      NM: PDFHexString.fromText('reply-1'),
    } as never)));
    annots.push(pdf.context.register(pdf.context.obj({
      Type: 'Annot', Subtype: 'Text', Rect: [20, 290, 38, 308],
      Contents: PDFHexString.fromText('新しい指摘'), NM: PDFHexString.fromText('new-1'),
    } as never)));
    return pdf.save();
  }

  it('書き足しも返信も、元の指摘のレビューファイルと番号に。新しい指摘は新しい指摘に', async () => {
    const review = await readReviewPdf(await returned());
    const plan = planImport(resolveAnnotations(review), review.map?.written);
    expect(plan.ours).toBe(1);
    expect(plan.fresh.map(one => one.annotation.body)).toEqual(['新しい指摘']);
    const replies = plan.replies.get('reviews/r1.review.yml')!;
    expect(replies.map(one => [one.id, one.body])).toEqual([
      [3, '了解です。10 回で確定'],
      [3, 'スレッドでの返信'],
    ]);
    // The written-on reply carries no author of its own: the name on the
    // annotation is still the commenter's, which we wrote.
    expect(replies[0]!.author).toBeUndefined();
    expect(replies[0]!.key).toMatch(/^dp-review:reviews\/r1\.review\.yml#3\/added-[0-9a-f]{8}$/);
  });

  it('同じ PDF を二度取り込んでも、書き足しは二度入らない', async () => {
    const review = await readReviewPdf(await returned());
    const replies = planImport(resolveAnnotations(review), review.map?.written).replies.get('reviews/r1.review.yml')!;
    const once = appendReplies(REVIEW, replies);
    expect(once.added).toBe(2);
    expect(appendReplies(once.text, replies).added).toBe(0);
  });

  it('返信は指摘の下に入る。前の行は変えず、二度は入らない', () => {
    const reply = { id: 3, body: '了解です', author: '発注者', key: 'reply-1' };
    const once = appendReplies(REVIEW, [reply]);
    expect(once.added).toBe(1);
    // Only lines added: every line of the file before is still there, in order.
    const kept = REVIEW.split('\n');
    const now = once.text.split('\n');
    let i = 0;
    for (const line of now) if (line === kept[i]) i += 1;
    expect(i).toBe(kept.length);
    const yaml = parse(once.text);
    expect(yaml.comments[0].replies).toEqual([{ body: '了解です', author: '発注者', annotation: 'reply-1' }]);
    expect(appendReplies(once.text, [reply])).toMatchObject({ added: 0, skipped: 1, text: once.text });
  });

  it('返信がすでにある指摘には、その後ろに足す', () => {
    const { text } = appendReplies(REVIEW, [{ id: 4, body: 'later', key: 'x-2' }]);
    expect(parse(text).comments[1].replies.map((one: { body: string }) => one.body)).toEqual(['earlier', 'later']);
  });

  it('ファイルに無い指摘への返信は入れない', () => {
    expect(appendReplies(REVIEW, [{ id: 99, body: '?', key: 'x-3' }])).toMatchObject({ added: 0, skipped: 1 });
  });
});
