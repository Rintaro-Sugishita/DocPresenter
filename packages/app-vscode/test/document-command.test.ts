// A new document, numbered: the series already in use offered with their next
// free number, a new series begun at 001, and a number in use refused.

import { describe, expect, it } from 'vitest';
import { newDocument, pickNumber } from '../src/document-command.js';
import { Uri, give, held, picks } from './fake-vscode.js';

const doc = (number: string) => `---\ndocument: ${number}\ntitle: T\n---\n\n# T\n`;
const REPO = {
  'docs/a.md': doc('SD-AUTH-001'),
  'docs/b.md': doc('SD-AUTH-002'),
  'docs/c.md': doc('SD-ORDER-001'),
  'shared/glossary.table': '| 用語 | 説明 |\n|---|---|\n',
};

/** The labels of the items the next quick pick offers, and picks the one `choose` says. */
const choosing = (choose: (labels: string[]) => number) => {
  const offered: string[][] = [];
  picks.quick = <T>(items: readonly T[]) => {
    const labels = items.map(item => (item as { label: string }).label);
    offered.push(labels);
    return [items[choose(labels)]!];
  };
  return offered;
};

describe('新しい文書', () => {
  it('いちばん大きい系列の次の番号で、テンプレートの frontmatter ごと作る', async () => {
    give(REPO);
    const offered = choosing(() => 0);
    picks.inputs = ['決済機能 設計書', 'payment'];
    await newDocument();
    expect(offered[0]![0]).toBe('docs/');
    expect(offered[1]!.slice(0, 2)).toEqual(['SD-AUTH-003', 'SD-ORDER-002']);
    const made = held.get('docs/payment.md')!;
    expect(made).toMatch(/^---\ndocument: SD-AUTH-003\ntitle: 決済機能 設計書\n/);
    expect(made).toContain('@import "payment/revision.md"');
    expect(made).toContain('@import "../shared/glossary.table"');
    expect(held.get('docs/payment/revision.md')).toContain('| 0.1 |');
  });

  it('フォルダを選ぶと、その中に作り、共有の用語集への道もその深さに合う', async () => {
    give({ ...REPO, 'docs/order/a.md': doc('SD-ORDER-002') });
    const offered = choosing(labels => labels.indexOf('docs/order/') >= 0 ? labels.indexOf('docs/order/') : 0);
    picks.inputs = ['受注 設計書', 'Ordering/受注画面'];
    await newDocument();
    expect(offered[0]).toEqual(['docs/', 'docs/order/', '別のフォルダ…']);
    const made = held.get('docs/order/Ordering/受注画面.md')!;
    expect(made).toContain('@import "受注画面/revision.md"');
    expect(made).toContain('@import "../../../shared/glossary.table"');
    expect(held.get('docs/order/Ordering/受注画面/revision.md')).toContain('| 0.1 |');
  });

  it('エクスプローラーで右クリックしたフォルダに作り、フォルダは聞かない', async () => {
    give(REPO);
    const offered = choosing(() => 0);
    picks.inputs = ['T', 'design.md'];
    await newDocument(Uri.file('/w/docs/billing'));
    expect(offered).toHaveLength(1);
    expect(held.get('docs/billing/design.md')).toContain('@import "../../shared/glossary.table"');
  });

  it('大文字・空白・日本語の名前は通し、ファイル名に使えないものは断る', async () => {
    give(REPO);
    choosing(() => 0);
    picks.inputs = ['T', 'a:b'];
    await newDocument();
    picks.inputs = ['T', 'CON'];
    await newDocument();
    picks.inputs = ['T', 'x/'];
    await newDocument();
    expect(picks.refused).toEqual([
      '\\ : * ? " < > | はファイル名に使えません',
      'CON は Windows が予約している名前なので使えません',
      '名前を入れてください（/ の前後も空にしない）',
    ]);
  });

  it('新しい系列は 001 から', async () => {
    give(REPO);
    choosing(labels => labels.indexOf('新しい系列を作る…'));
    picks.inputs = ['SD-PAY-'];
    expect(await pickNumber('t')).toBe('SD-PAY-001');
  });

  it('使われている番号は受け付けない', async () => {
    give(REPO);
    choosing(labels => labels.indexOf('自分で入力する…'));
    picks.inputs = ['SD-AUTH-002'];
    expect(await pickNumber('t')).toBeUndefined();
    expect(picks.refused).toEqual(['SD-AUTH-002 はもう docs/b.md で使われている']);
  });

  it('同じ名前の文書があれば作らない', async () => {
    give(REPO);
    choosing(() => 0);
    picks.inputs = ['T', 'a'];
    await newDocument();
    expect(picks.refused).toEqual(['docs/a.md はもうある']);
    expect(held.get('docs/a.md')).toBe(doc('SD-AUTH-001'));
  });

  it('番号の無いリポジトリでは DOC-001 を薦める', async () => {
    give({ 'docs/x.md': '# 番号の無い文書\n' });
    const offered = choosing(() => 0);
    expect(await pickNumber('t')).toBe('DOC-001');
    expect(offered[0]![0]).toBe('DOC-001');
  });
});
