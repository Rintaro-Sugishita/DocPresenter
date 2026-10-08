// Taking a reviewer's PDF into a review file from VS Code: a new file for the
// round, or appended to one that is there — and never twice.

import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { byteLength } from '@docpresenter/base';
import { writePdf, type PagePlan } from '@docpresenter/pdf';
import { importReview } from '../src/review-command.js';
import { give, held, picks, saved, shown, Uri, written } from './fake-vscode.js';

const DOC = '# Design\n\nThe login screen locks after five failures.\n';
const prose = { start: byteLength('# Design\n\n'), end: byteLength(DOC) - 1 };

/** A PDF of the document with one highlight on "five failures", as a viewer saves it. */
async function annotatedPdf(): Promise<Uint8Array> {
  const plan: PagePlan = {
    width: 300, height: 400,
    pages: [{ items: [{
      kind: 'text', text: 'The login screen locks after five failures.', x: 50, y: 100, size: 10,
      bold: false, italic: false, family: 'body', colour: '#000000', span: prose,
    }] }],
  };
  const { bytes } = await writePdf(plan, {
    fonts: {} as never, review: { document: 'docs/a.md', commit: 'abc1234', clean: true, files: { 'docs/a.md': DOC } },
  });
  const pdf = await PDFDocument.load(bytes);
  const [x0, x1, top, bottom] = [50 + 29 * 5.5, 50 + 42 * 5.5, 400 - 91, 400 - 102];
  pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(pdf.context.obj({
    Type: 'Annot', Subtype: 'Highlight', Rect: [x0, bottom, x1, top],
    QuadPoints: [x0, top, x1, top, x0, bottom, x1, bottom],
    Contents: PDFHexString.fromText('10 回にしてほしい'), NM: PDFHexString.fromText('h-1'),
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
});
