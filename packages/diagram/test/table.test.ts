// Tables on a screen that hold what is in them.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import {
  addTableColumn, addTableRow, DiagramEditError, isEmptyTable, layOutDiagram, makeTable, parseDiagram,
  removeTableColumn, removeTableRow, renderDiagram, setNodePart, tableOf, withParts,
} from '../src/index.js';

const SCREEN = [
  'use "default"',
  '',
  'free {',
  '  frame    frame:',
  '  results  grid:',
  '}',
  '',
  'layout {',
  '  frame    @ (0, 0) 400x300',
  '  results  @ (20, 20) 360x120',
  '}',
  '',
].join('\n');

const read = (text: string) => withParts(parseDiagram(text), () => undefined);
const step = (text: string, edit: ReturnType<typeof makeTable>) => applyEdit(text, edit);

describe('表に中身を作る', () => {
  it('見出しの行と 1 行ぶんのセルを作り、セルは図形になる', () => {
    expect(isEmptyTable(read(SCREEN), 'results')).toBe(true);
    const text = step(SCREEN, makeTable(read(SCREEN), SCREEN, 'results', ['氏名', '所属']));
    expect(text).toContain('  resultsH1 label:"氏名"');
    expect(text).toContain('  resultsH2 label:"所属"');
    expect(text).toContain('  resultsR1 body:""');
    expect(text).toContain('grid results (cols: 1fr, 1fr; gap: 4 12; pad: 6) {');
    expect(text).toContain('resultsH1 ; resultsH2');
    const file = read(text);
    expect(tableOf(file, 'resultsR2')).toEqual({ table: 'results', row: 1, col: 1 });
    expect(tableOf(file, 'results')?.table).toBe('results');
    expect(isEmptyTable(file, 'results')).toBe(false);
  });

  it('罫線はセルの間に引かれ、見出しの行が網掛けになる', () => {
    const text = step(SCREEN, makeTable(read(SCREEN), SCREEN, 'results', ['氏名', '所属', '最終ログイン']));
    const laid = layOutDiagram(read(text));
    const rules = laid.tables.find(one => one.container === 'results');
    expect(rules?.columns).toHaveLength(2);
    expect(rules?.rows).toHaveLength(1);
    const svg = renderDiagram(read(text));
    expect(svg).toContain('dp-table-art');
    expect(svg).toContain('dp-table-head');
  });

  it('セルの部品は変えられる（チェックボックスを置く）', () => {
    const text = step(SCREEN, makeTable(read(SCREEN), SCREEN, 'results', ['選択', '氏名']));
    const checked = applyEdit(text, setNodePart(read(text), text, 'resultsR1', 'checkbox'));
    expect(checked).toMatch(/resultsR1 checkbox:/);
    expect(tableOf(read(checked), 'resultsR1')).toEqual({ table: 'results', row: 1, col: 0 });
  });

  it('行が増えれば表は伸びる（ピンの高さで詰めない）', () => {
    let text = step(SCREEN, makeTable(read(SCREEN), SCREEN, 'results', ['氏名']));
    for (let i = 0; i < 6; i++) text = step(text, addTableRow(read(text), text, 'results', undefined));
    const laid = layOutDiagram(read(text));
    expect(laid.boxes.get('results')!.height).toBeGreaterThan(120);
    expect(laid.diagnostics.join(' ')).not.toContain('入りきらない');
  });
});

describe('行と列', () => {
  const made = step(SCREEN, makeTable(read(SCREEN), SCREEN, 'results', ['氏名', '所属']));

  it('選んだ行の下に行を足す', () => {
    const text = step(made, addTableRow(read(made), made, 'results', 0));
    const grid = read(text).containers.get('results')!;
    expect(grid.cells).toHaveLength(3);
    expect(grid.cells[1]).toEqual(['resultsR3', 'resultsR4']);
  });

  it('右に列を足すと、見出しには題が入り、cols も 1 つ増える', () => {
    const text = step(made, addTableColumn(read(made), made, 'results', 0, '列'));
    expect(text).toContain('cols: 1fr, 1fr, 1fr');
    const grid = read(text).containers.get('results')!;
    expect(grid.cells[0]).toEqual(['resultsH1', 'resultsC1', 'resultsH2']);
    expect(text).toContain('resultsC1 label:"列"');
  });

  it('行を消すと、その行の図形も消える', () => {
    const text = step(made, removeTableRow(read(made), made, 'results', 1));
    expect(text).not.toContain('resultsR1');
    expect(read(text).containers.get('results')!.cells).toEqual([['resultsH1', 'resultsH2']]);
  });

  it('列を消すと、その列の図形も cols も減る', () => {
    const text = step(made, removeTableColumn(read(made), made, 'results', 0));
    expect(text).not.toContain('resultsH1');
    expect(text).not.toContain('resultsR1');
    expect(text).toContain('cols: 1fr;');
    expect(read(text).containers.get('results')!.cells).toEqual([['resultsH2'], ['resultsR2']]);
  });

  it('最後の行・最後の列は消せない', () => {
    const alone = step(made, removeTableRow(read(made), made, 'results', 1));
    expect(() => removeTableRow(read(alone), alone, 'results', 0)).toThrow(DiagramEditError);
    const narrow = step(made, removeTableColumn(read(made), made, 'results', 0));
    expect(() => removeTableColumn(read(narrow), narrow, 'results', 0)).toThrow(DiagramEditError);
  });
});

describe('別ファイルの部品ライブラリを使う画面', () => {
  it('ライブラリを読み直さずに、行と列を足し引きできる', () => {
    const lib = readFileSync(new URL('../../../sample/shared/ui-parts.dgm', import.meta.url), 'utf8');
    const reader = (path: string) => (path.endsWith('ui-parts.dgm') ? lib : undefined);
    const own = SCREEN.replace('use "default"', 'use "../../shared/ui-parts.dgm"');
    const file = (text: string) => withParts(parseDiagram(text), reader);
    let text = applyEdit(own, makeTable(file(own), own, 'results', ['a', 'b']));
    text = applyEdit(text, addTableRow(file(text), text, 'results', 1));
    text = applyEdit(text, addTableColumn(file(text), text, 'results', 0, 'x'));
    text = applyEdit(text, removeTableRow(file(text), text, 'results', 2));
    text = applyEdit(text, removeTableColumn(file(text), text, 'results', 1));
    expect(file(text).containers.get('results')!.cells).toEqual([['resultsH1', 'resultsH2'], ['resultsR1', 'resultsR2']]);
  });
});
