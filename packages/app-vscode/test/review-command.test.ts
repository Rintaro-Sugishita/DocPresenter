// Taking a reviewer's PDF into a review file from VS Code: a new file for the
// round, or appended to one that is there — and never twice.

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { byteLength } from '@docpresenter/base';
import { writePdf, type PagePlan } from '@docpresenter/pdf';
import { importReview } from '../src/review-command.js';
import { give, held, picks, saved, shown, Uri, written } from './fake-vscode.js';

const DOC = '# Design\n\nThe login screen locks after five failures.\n';
const prose = { start: byteLength('# Design\n\n'), end: byteLength(DOC) - 1 };

/** A PDF of the document with one highlight on "five failures", as a viewer saves it. */
async function annotatedPdf(document = 'docs/a.md', number?: string, body = '10 回にしてほしい'): Promise<Uint8Array> {
  const plan: PagePlan = {
    width: 300, height: 400,
    pages: [{ items: [{
      kind: 'text', text: 'The login screen locks after five failures.', x: 50, y: 100, size: 10,
      bold: false, italic: false, family: 'body', colour: '#000000', span: prose,
    }] }],
  };
  const { bytes } = await writePdf(plan, {
    fonts: {} as never,
    review: { document, ...(number ? { number } : {}), commit: 'abc1234', clean: true, files: { [document]: DOC } },
  });
  const pdf = await PDFDocument.load(bytes);
  const [x0, x1, top, bottom] = [50 + 29 * 5.5, 50 + 42 * 5.5, 400 - 91, 400 - 102];
  pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(pdf.context.obj({
    Type: 'Annot', Subtype: 'Highlight', Rect: [x0, bottom, x1, top],
    QuadPoints: [x0, top, x1, top, x0, bottom, x1, bottom],
    Contents: PDFHexString.fromText(body), NM: PDFHexString.fromText(`h-${document}`),
  } as never))]));
  return pdf.save();
}

const output = () => ({
  lines: [] as string[], clear() { this.lines.length = 0; }, show() { /* 画面は無い */ },
  appendLine(line: string) { this.lines.push(line); },
});

describe('PDF の注釈を指摘として取り込むコマンド', () => {
  it('新しいレビューファイルに、語を指す指摘として入る', async () => {
    give({ 'docs/a.md': DOC });
    written.set('out/build/a.pdf', await annotatedPdf());
    picks.quick = <T>(items: readonly T[]) => [items[0]!] as never;
    await importReview(output(), Uri.file('/w/out/build/a.pdf'));
    const file = [...written.keys()].find(path => /^reviews\/\d{4}-\d{2}-\d{2}-a\.review\.yml$/.test(path));
    expect(file).toBeDefined();
    const text = new TextDecoder().decode(written.get(file!));
    expect(text).toContain('quote:  "five failures"');
    expect(text).toContain('body:   "10 回にしてほしい"');
    expect(text).toContain('commit: abc1234');
    expect(shown.some(message => message.includes('1 件の指摘'))).toBe(true);
  });

  it('既にあるファイルには後ろに足すだけ。同じ注釈は二度入らない', async () => {
    const BEFORE = 'round: "第 1 回"\nvia: pdf\n\ncomments:\n  - id: 3\n    body: "既存"\n    reply: "対応済み"\n';
    give({ 'docs/a.md': DOC, 'reviews/round-1.review.yml': BEFORE });
    written.set('out/build/a.pdf', await annotatedPdf());
    picks.quick = <T>(items: readonly T[]) => [items[1]!] as never;
    await importReview(output(), Uri.file('/w/out/build/a.pdf'));
    const after = held.get('reviews/round-1.review.yml')!;
    expect(after.startsWith(BEFORE)).toBe(true);
    expect(after).toContain('  - id: 4\n');
    expect(saved).toContain('reviews/round-1.review.yml');

    await importReview(output(), Uri.file('/w/out/build/a.pdf'));
    expect(held.get('reviews/round-1.review.yml')).toBe(after);
    expect(shown.some(message => message.includes('すでに入っています'))).toBe(true);
  });

  it('PDF に載せた指摘への返信は、聞かずにその指摘の下に入る', async () => {
    const REVIEW = 'round: "第 1 回"\nvia: pdf\n\ncomments:\n  - id: 3\n    body: "10 回にしてほしい"\n    status: open\n    reply: "10 回にしました"\n';
    give({ 'docs/a.md': DOC, 'reviews/r1.review.yml': REVIEW });
    // The PDF as sent — the comment written into it — with the customer's reply to it.
    const plan: PagePlan = {
      width: 300, height: 400,
      pages: [{ items: [{
        kind: 'text', text: 'The login screen locks after five failures.', x: 50, y: 100, size: 10,
        bold: false, italic: false, family: 'body', colour: '#000000', span: prose,
      }] }],
    };
    const quote = 'five failures';
    const start = byteLength(DOC.slice(0, DOC.indexOf(quote)));
    const { bytes } = await writePdf(plan, {
      fonts: {} as never,
      review: {
        document: 'docs/a.md', files: { 'docs/a.md': DOC },
        notes: [{
          key: 'dp-review:reviews/r1.review.yml#3', file: 'docs/a.md', start, end: start + byteLength(quote),
          body: '10 回にしてほしい', status: 'open', replies: [{ key: 'dp-review:reviews/r1.review.yml#3/answer', body: '10 回にしました' }],
        }],
      },
    });
    const pdf = await PDFDocument.load(bytes);
    const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots')) as unknown as { get(i: number): unknown; push(ref: unknown): void };
    annots.push(pdf.context.register(pdf.context.obj({
      Type: 'Annot', Subtype: 'Text', IRT: annots.get(0), Rect: [0, 0, 10, 10],
      Contents: PDFHexString.fromText('確認しました'), T: PDFHexString.fromText('発注者'), NM: PDFHexString.fromText('reply-1'),
    } as never)));
    written.set('out/build/a.pdf', await pdf.save());
    picks.quick = () => { throw new Error('asked where to put new comments, but there are none'); };
    await importReview(output(), Uri.file('/w/out/build/a.pdf'));
    const after = held.get('reviews/r1.review.yml')!;
    expect(after).toContain('    replies:\n      - body:   "確認しました"\n        author: "発注者"\n        annotation: "reply-1"');
    expect(saved).toContain('reviews/r1.review.yml');
    expect(shown.some(message => message.includes('返信 1 件'))).toBe(true);
  });

  it('複数の PDF をまとめて取り込み、指摘はそれぞれの文書と文書番号に付く', async () => {
    give({ 'docs/a.md': DOC, 'docs/b.md': DOC });
    written.set('out/build/a.pdf', await annotatedPdf('docs/a.md', 'SD-A-001', 'A への指摘'));
    written.set('out/build/b.pdf', await annotatedPdf('docs/b.md', 'SD-B-001', 'B への指摘'));
    let asked = 0;
    picks.quick = <T>(items: readonly T[]) => { asked += 1; return [items[0]!] as never; };
    await importReview(output(), undefined, [Uri.file('/w/out/build/a.pdf'), Uri.file('/w/out/build/b.pdf')]);
    expect(asked).toBe(1);
    const file = [...written.keys()].find(path => /^reviews\/\d{4}-\d{2}-\d{2}-review\.review\.yml$/.test(path))!;
    const comments = parse(new TextDecoder().decode(written.get(file))).comments;
    expect(comments.map((one: { body: string; context: { document: string; number: string } }) =>
      [one.body, one.context.document, one.context.number])).toEqual([
      ['A への指摘', 'docs/a.md', 'SD-A-001'],
      ['B への指摘', 'docs/b.md', 'SD-B-001'],
    ]);
    expect(comments.map((one: { id: number }) => one.id)).toEqual([1, 2]);
  });
});
