// Tables on a screen that hold what is in them.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import {
  addTableColumn, addTableRow, DiagramEditError, formatDiagram, isEmptyTable, layOutDiagram, makeTable, parseDiagram,
  removeTableColumn, removeTableRow, renameColumn, renderDiagram, setColumnPart, setNodePart, setRowRole, setScroll,
  tableOf, withParts,
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
    expect(text).toContain('grid results (cols: col1 1fr, col2 1fr; gap: 4 12; pad: 6) {');
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
    expect(text).toContain('cols: col1 1fr, col3 1fr, col2 1fr');
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
    expect(text).toContain('cols: col2 1fr;');
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

describe('見出し・明細・フッタ', () => {
  const made = step(SCREEN, makeTable(read(SCREEN), SCREEN, 'results', ['選択', '氏名']));
  const twoRows = step(made, addTableRow(read(made), made, 'results', undefined));

  it('head と foot を読み書きする（既定は見出し 1 行・フッタなし）', () => {
    const grid = read(made).containers.get('results')!;
    expect([grid.head, grid.foot]).toEqual([1, 0]);
    const text = made.replace('pad: 6)', 'pad: 6; head: 2; foot: 1)');
    const again = read(text).containers.get('results')!;
    expect([again.head, again.foot]).toEqual([2, 1]);
    expect(() => parseDiagram(made.replace('pad: 6)', 'pad: 6; foot: x)'))).toThrow();
  });

  it('行の種類を変えると head / foot が書き換わる', () => {
    const footed = step(twoRows, setRowRole(read(twoRows), twoRows, 'results', 2, 'foot'));
    expect(footed).toContain('col2 1fr; foot: 1; gap: 4 12; pad: 6) {');
    expect(read(footed).containers.get('results')!.foot).toBe(1);
    const back = step(footed, setRowRole(read(footed), footed, 'results', 2, 'body'));
    expect(back).not.toContain('foot:');
    const headed = step(twoRows, setRowRole(read(twoRows), twoRows, 'results', 1, 'head'));
    expect(headed).toContain('head: 2');
    expect(() => setRowRole(read(made), made, 'results', 0, 'head')).toThrow(DiagramEditError);
  });

  it('フッタの行を消すと foot も減る', () => {
    const footed = step(twoRows, setRowRole(read(twoRows), twoRows, 'results', 2, 'foot'));
    const text = step(footed, removeTableRow(read(footed), footed, 'results', 2));
    expect(text).not.toContain('foot:');
  });

  it('フッタとヘッダの罫線は濃く、フッタは淡く網掛けされる', () => {
    const footed = step(twoRows, setRowRole(read(twoRows), twoRows, 'results', 2, 'foot'));
    const rules = layOutDiagram(read(footed)).tables.find(one => one.container === 'results')!;
    expect([rules.head, rules.foot]).toEqual([1, 1]);
    expect(renderDiagram(read(footed))).toContain('dp-table-foot');
  });
});

describe('列単位の操作', () => {
  const made = step(SCREEN, makeTable(read(SCREEN), SCREEN, 'results', ['選択', '氏名']));
  const rows = (() => {
    let text = made;
    for (let i = 0; i < 2; i++) text = step(text, addTableRow(read(text), text, 'results', undefined));
    return text;
  })();

  it('列の部品を変えると、明細のセルが全部変わる（見出しとフッタはそのまま）', () => {
    const footed = step(rows, setRowRole(read(rows), rows, 'results', 3, 'foot'));
    const text = step(footed, setColumnPart(read(footed), footed, 'results', 0, 'checkbox'));
    const file = read(text);
    const grid = file.containers.get('results')!;
    expect(grid.cells.slice(1, 3).map(row => file.partOf.get(row[0]!))).toEqual(['checkbox', 'checkbox']);
    expect(file.partOf.get(grid.cells[0]![0]!)).toBe('label');
    expect(file.partOf.get(grid.cells[3]![0]!)).toBe('body');
  });

  it('足した行は上の行の部品を引き継ぐ', () => {
    const checked = step(rows, setColumnPart(read(rows), rows, 'results', 0, 'checkbox'));
    const text = step(checked, addTableRow(read(checked), checked, 'results', undefined));
    const file = read(text);
    const last = file.containers.get('results')!.cells.at(-1)!;
    expect(file.partOf.get(last[0]!)).toBe('checkbox');
    expect(file.partOf.get(last[1]!)).toBe('body');
  });

  it('フッタを選んで行を足しても、明細の最後に入る', () => {
    const footed = step(rows, setRowRole(read(rows), rows, 'results', 3, 'foot'));
    const foot = read(footed).containers.get('results')!.cells[3]!;
    const text = step(footed, addTableRow(read(footed), footed, 'results', 3));
    const grid = read(text).containers.get('results')!;
    expect(grid.cells.at(-1)).toEqual(foot);
    expect(grid.cells).toHaveLength(5);
  });

  it('列に名前を付ける（重複と使えない文字は断る）', () => {
    const text = step(made, renameColumn(read(made), made, 'results', 0, 'pick'));
    expect(text).toContain('cols: pick 1fr, col2 1fr');
    expect(read(text).containers.get('results')!.names).toEqual(['pick', 'col2']);
    expect(() => renameColumn(read(text), text, 'results', 1, 'pick')).toThrow(DiagramEditError);
    expect(() => renameColumn(read(text), text, 'results', 1, 'a.b')).toThrow(DiagramEditError);
  });

  it('cols の名前は書いたとおりに整形で残る', () => {
    const text = made.replace('cols: col1 1fr, col2 1fr', 'cols: pick 40, name');
    const file = parseDiagram(text);
    expect(file.containers.get('results')!.cols).toEqual(['40', '1fr']);
    expect(formatDiagram(text).text).toContain('cols: pick 40, name 1fr');
  });
});

describe('スクロール', () => {
  const made = (() => {
    let text = step(SCREEN, makeTable(read(SCREEN), SCREEN, 'results', ['氏名']));
    for (let i = 0; i < 8; i++) text = step(text, addTableRow(read(text), text, 'results', undefined));
    return text;
  })();

  it('縦にスクロールする表は伸びずに切れ、バーは見出しの下から始まる', () => {
    const text = step(made, setScroll(read(made), made, 'results', 'down'));
    expect(text).toContain('scroll) {');
    const laid = layOutDiagram(read(text));
    expect(laid.boxes.get('results')!.height).toBe(120);
    const svg = renderDiagram(read(text));
    const rules = laid.tables.find(one => one.container === 'results')!;
    const track = /class="dp-scroll-track" x="[^"]+" y="([^"]+)"/.exec(svg);
    expect(Number(track?.[1])).toBeCloseTo(rules.rows[0]!, 0);
  });

  it('縦横どちらにも出せる', () => {
    const text = step(made, setScroll(read(made), made, 'results', 'both'));
    expect(text).toContain('scroll: both');
    const svg = renderDiagram(read(text));
    expect(svg.match(/dp-scroll-track/g)).toHaveLength(2);
    const back = step(text, setScroll(read(text), text, 'results', 'none'));
    expect(back).not.toContain('scroll');
  });

  it('フッタは切れずに下に残り、明細だけが切れる', () => {
    const footed = step(made, setRowRole(read(made), made, 'results', 9, 'foot'));
    const text = step(footed, setScroll(read(footed), footed, 'results', 'down'));
    const file = read(text);
    const grid = file.containers.get('results')!;
    const laid = layOutDiagram(file);
    const box = laid.boxes.get('results')!;
    const foot = laid.boxes.get(grid.cells[9]![0]!)!;
    expect(foot.y + foot.height).toBeLessThanOrEqual(box.y + box.height);
    expect(laid.boxes.has(grid.cells[8]![0]!)).toBe(false);
    expect(laid.boxes.has(grid.cells[1]![0]!)).toBe(true);
  });

  it('入れ物でなければ断る', () => {
    expect(() => setScroll(read(made), made, 'frame', 'down')).toThrow(DiagramEditError);
  });
});
