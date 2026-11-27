import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import { parseTable } from '@docpresenter/markdown';
import { inSequence, insertRow, removeColumn } from '../src/index.js';

const SOURCE = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

describe('選んだ数だけまとめて', () => {
  it('行を 2 つ足すのは 1 つの編集', () => {
    const edit = inSequence(SOURCE, [0, 1].map(() => (one: ReturnType<typeof parseTable>) => insertRow(one, 1)));
    const rows = parseTable(applyEdit(SOURCE, edit)).rows;
    expect(rows).toHaveLength(4);
    expect(rows.map(row => row.cells[0]?.text)).toEqual(['1', '', '', '4']);
  });

  it('列を右から消す', () => {
    const edit = inSequence(SOURCE, [2, 1].map(n => (one: ReturnType<typeof parseTable>) => removeColumn(one, n)));
    expect(parseTable(applyEdit(SOURCE, edit)).columns.map(c => c.header)).toEqual(['a']);
  });
});
