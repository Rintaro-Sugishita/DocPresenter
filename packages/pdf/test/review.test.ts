// Review comments on a PDF, traced back to the source: the map the writer
// attaches, the annotations a viewer adds, and the review file they become.

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PDFDocument, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { byteLength, findPrinted as findIn } from '@docpresenter/base';
import {
  appendReview, readReviewPdf, resolveAnnotations, writePdf, type PagePlan,
} from '../src/index.js';

const DOC = '# Design\n\nThe login screen locks after five failures.\nUnlock is manual only.\n\n@import "a/flow.dgm" {#fig-flow}\n';
const DGM = 'flow {\n  api [Auth API]\n  db [(Member DB)]\n  api --> db\n}\n';
const files = { 'docs/a.md': DOC, 'docs/a/flow.dgm': DGM };

/** The byte range of a piece of the document, as a mark carries it. */
const spanOf = (text: string, piece: string) => {
  const start = byteLength(text.slice(0, text.indexOf(piece)));
  return { start, end: start + byteLength(piece) };
};
const prose = spanOf(DOC, 'The login screen locks after five failures.\nUnlock is manual only.');
const figure = spanOf(DOC, '@import "a/flow.dgm" {#fig-flow}');
const text = (value: string, x: number, y: number, span: { start: number; end: number }) => ({
  kind: 'text' as const, text: value, x, y, size: 10, bold: false, italic: false,
  family: 'body' as const, colour: '#000000', span,
});

const HEIGHT = 400;
const PLAN: PagePlan = {
  width: 300, height: HEIGHT,
  pages: [{ items: [
    text('Design', 50, 60, spanOf(DOC, '# Design')),
    text('The login screen locks after five failures.', 50, 100, prose),
    text('Unlock is manual only.', 50, 114, prose),
    { kind: 'fill', x: 50, y: 150, width: 200, height: 100, colour: '#ffffff', span: figure },
    text('Auth API', 70, 180, figure),
    text('Member DB', 160, 230, figure),
  ] }],
};

/** A PDF as a viewer leaves it: ours, with annotations added and saved again. */
async function annotated(add: (pdf: PDFDocument) => (Record<string, unknown> | PDFRef)[]): Promise<Uint8Array> {
  const { bytes } = await writePdf(PLAN, {
    fonts: {} as never,
    review: { document: 'docs/a.md', commit: 'abc1234', clean: true, files },
  });
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(0);
  // An annotation already registered (one a reply points at) goes in as it is.
  const refs = add(pdf).map(fields => fields instanceof PDFRef
    ? fields : pdf.context.register(pdf.context.obj(fields as never)));
  page.node.set(PDFName.of('Annots'), pdf.context.obj(refs));
  return pdf.save();
}

/** A highlight over x0..x1 on the line whose baseline is at `y`, as Acrobat writes one. */
const highlight = (x0: number, x1: number, y: number, extra: Record<string, unknown> = {}) => {
  const top = HEIGHT - (y - 9);
  const bottom = HEIGHT - (y + 2);
  return {
    Type: 'Annot', Subtype: 'Highlight',
    Rect: [x0, bottom, x1, top], QuadPoints: [x0, top, x1, top, x0, bottom, x1, bottom],
    ...extra,
  };
};

describe('PDF の注釈を指摘にする', () => {
  it('ハイライトした語は、その語のバイト範囲になる', async () => {
    // "The login screen locks after " は 29 字。半角は 5.5pt 幅として組んでいる。
    const bytes = await annotated(() => [highlight(50 + 29 * 5.5, 50 + 42 * 5.5, 100, {
      Contents: PDFString.of('Make it ten'), T: PDFString.of('Customer'), NM: PDFString.of('h-1'),
    })]);
    const review = await readReviewPdf(bytes);
    expect(review.commit).toBe('abc1234');
    const [one] = resolveAnnotations(review);
    expect(one!.precision).toBe('text');
    expect(one!.anchor).toEqual({ file: 'docs/a.md', ...spanOf(DOC, 'five failures'), quote: 'five failures' });
    expect(one!.annotation.body).toBe('Make it ten');
    expect(one!.annotation.author).toBe('Customer');
  });

  it('図の中の語は、図のファイルの中を指す', async () => {
    const bytes = await annotated(() => [highlight(70, 70 + 8 * 5.5, 180)]);
    const [one] = resolveAnnotations(await readReviewPdf(bytes));
    expect(one!.precision).toBe('text');
    expect(one!.anchor).toEqual({ file: 'docs/a/flow.dgm', ...spanOf(DGM, 'Auth API'), quote: 'Auth API' });
  });

  it('付箋や囲みは、その段落や図の全体を指す', async () => {
    const bytes = await annotated(() => [
      { Type: 'Annot', Subtype: 'Text', Rect: [20, HEIGHT - 116, 38, HEIGHT - 104], Contents: PDFString.of('Why manual?') },
      { Type: 'Annot', Subtype: 'Square', Rect: [60, HEIGHT - 240, 240, HEIGHT - 160], Contents: PDFString.of('Redraw this') },
    ]);
    const [note, box] = resolveAnnotations(await readReviewPdf(bytes));
    expect(note!.precision).toBe('block');
    expect(note!.anchor?.start).toBe(prose.start);
    expect(note!.anchor?.quote).toContain('Unlock is manual only.');
    expect(box!.precision).toBe('block');
    expect(box!.anchor).toEqual({ file: 'docs/a.md', ...figure, quote: '@import "a/flow.dgm" {#fig-flow}' });
  });

  it('何も無いところの注釈も捨てない', async () => {
    const bytes = await annotated(() => [
      { Type: 'Annot', Subtype: 'FreeText', Rect: [250, 10, 290, 30], Contents: PDFString.of('Overall: OK') },
    ]);
    const [one] = resolveAnnotations(await readReviewPdf(bytes));
    expect(one!.precision).toBe('none');
    expect(one!.anchor).toBeUndefined();
    expect(one!.annotation.body).toBe('Overall: OK');
  });

  it('地図の無い PDF でも注釈は読める', async () => {
    const { bytes } = await writePdf(PLAN, { fonts: {} as never });
    const pdf = await PDFDocument.load(bytes);
    pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(pdf.context.obj(
      { Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 30, 30], Contents: PDFString.of('hello') } as never))]));
    const [one] = resolveAnnotations(await readReviewPdf(await pdf.save()));
    expect(one!.precision).toBe('none');
    expect(one!.annotation.body).toBe('hello');
  });
});

describe('レビューファイル', () => {
  const round = { round: '2026-10-07 顧客レビュー', pdf: 'out/build/a.pdf', document: 'docs/a.md', commit: 'abc1234', clean: true };

  it('新しいファイルは指摘管理表として読める。返信は元の指摘の下に入る', async () => {
    const bytes = await annotated(pdf => {
      const parent = highlight(50 + 29 * 5.5, 50 + 42 * 5.5, 100, { Contents: PDFString.of('Make it ten'), NM: PDFString.of('h-1') });
      const ref = pdf.context.register(pdf.context.obj(parent as never));
      return [ref, {
        Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 1, 1], IRT: ref,
        Contents: PDFString.of('Agreed'), T: PDFString.of('Engineer'),
      }];
    });
    const resolved = resolveAnnotations(await readReviewPdf(bytes));
    const { text, added } = appendReview(undefined, resolved, round);
    const yaml = parse(text);
    expect(added).toBe(1);
    expect(yaml.via).toBe('pdf');
    expect(yaml.comments[0].replies).toEqual([
      expect.objectContaining({ body: 'Agreed', author: 'Engineer' }),
    ]);
    const first = yaml.comments[0];
    expect(first).toMatchObject({
      id: 1, status: 'open', body: 'Make it ten',
      anchor: { commit: 'abc1234', file: 'docs/a.md', quote: 'five failures' },
      context: { document: 'docs/a.md' },
      source: { pdf: 'out/build/a.pdf', page: 1, kind: 'Highlight', precision: 'text' },
    });
  });

  it('追記は後ろに足すだけで、前の行を変えない。同じ注釈は二度入らない', async () => {
    const bytes = await annotated(() => [
      highlight(50 + 29 * 5.5, 50 + 42 * 5.5, 100, { Contents: PDFString.of('Make it ten'), NM: PDFString.of('h-1') }),
    ]);
    const resolved = resolveAnnotations(await readReviewPdf(bytes));
    const before = '# 手で書いた行\nround: "第 1 回"\nvia: pdf\n\ncomments:\n  - id: 7\n    body: "既存"\n    reply: "対応済み"\n';
    const once = appendReview(before, resolved, round);
    expect(once.text.startsWith(before)).toBe(true);
    expect(parse(once.text).comments.map((one: { id: number }) => one.id)).toEqual([7, 8]);
    const again = appendReview(once.text, resolved, round);
    expect(again).toMatchObject({ added: 0, skipped: 1, text: once.text });
  });

  it('アンカーの無い指摘は orphaned として残す。未コミットの版ならそう書く', async () => {
    const bytes = await annotated(() => [
      { Type: 'Annot', Subtype: 'FreeText', Rect: [250, 10, 290, 30], Contents: PDFString.of('Overall: OK') },
    ]);
    const { text } = appendReview(undefined, resolveAnnotations(await readReviewPdf(bytes)), { ...round, clean: false });
    const [one] = parse(text).comments;
    expect(one.status).toBe('orphaned');
    expect(one.anchor.uncommitted).toBe(true);
    expect(one.anchor.page).toBe(1);
  });
});

describe('印字された語をソースから探す', () => {
  it('空白・改行・強調の記号を飛ばして一致させる', () => {
    const source = 'ロックの解除は\n**管理者**による手動操作のみ。';
    expect(findIn(source, 0, byteLength(source), '解除は管理者による')?.quote).toBe('解除は\n**管理者**による');
  });

  it('同じ語が 2 回あると、どちらか決められないので狭めない', () => {
    expect(findIn('API と API', 0, 12, 'API')).toBeUndefined();
  });
});
