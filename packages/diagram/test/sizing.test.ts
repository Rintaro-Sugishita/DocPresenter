import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import {
  addZone, DEFAULT_PARTS, formatDiagram, layOutDiagram, parseDiagram, pinNode, removeNodes, sizeNode, withParts,
} from '../src/index.js';

const SOURCE = [
  'use "default"',
  '',
  'free {',
  '  form  ""',
  '  l1    label:"名前"',
  '  b1    textbox:',
  '  l2    label:"備考"',
  '  b2    textbox:',
  '}',
  '',
  'layout {',
  '  form @ (40, 40)',
  '  grid form (cols: auto, 1fr; gap: 8; pad: 0) {',
  '    l1 ; b1',
  '    l2 ; b2',
  '  }',
  '}',
  '',
].join('\n');

const read = (text: string) => withParts(parseDiagram(text), path => (path === 'default' ? DEFAULT_PARTS : undefined));

describe('大きさだけの行', () => {
  it('入れ物の中の部品は、大きさを変えても入れ物に残る', () => {
    const before = read(SOURCE);
    const text = applyEdit(SOURCE, sizeNode(before, SOURCE, 'b2', { width: 300, height: 80 }));
    expect(text).toMatch(/b2\s+300x80/);
    expect(text).not.toMatch(/b2\s*@/);
    const after = read(text);
    expect(after.sizes?.get('b2')).toMatchObject({ width: 300, height: 80 });
    const laid = layOutDiagram(after, 'ja');
    // Still in the grid's second row, under the first text box, and 80 tall.
    expect(laid.boxes.get('b2')!.x).toBe(laid.boxes.get('b1')!.x);
    expect(laid.boxes.get('b2')!.height).toBe(80);
    // Written again, it rewrites the line it has.
    const again = applyEdit(text, sizeNode(after, text, 'b2', { width: 300, height: 120 }));
    expect(again.match(/b2\s+300x/g)).toHaveLength(1);
    expect(again).toMatch(/b2\s+300x120/);
  });

  it('整形しても残り、削除すると一緒に消え、ピンにすると大きさはピンへ移る', () => {
    const text = applyEdit(SOURCE, sizeNode(read(SOURCE), SOURCE, 'b2', { width: 300, height: 80 }));
    const formatted = formatDiagram(text);
    expect(formatted.text).toMatch(/b2\s+300x80/);
    const removed = applyEdit(text, removeNodes(read(text), text, ['b2']));
    expect(removed).not.toContain('300x80');
    const pinned = applyEdit(text, pinNode(read(text), text, 'b2', { x: 10, y: 20 }));
    expect(pinned).toMatch(/b2\s*@ \(10, 20\) 300x80/);
    expect(pinned).not.toMatch(/b2\s+300x80/);
  });
});

describe('区画（枠）', () => {
  it('中身の無いグループを、置いた場所に大きさ付きで置く', () => {
    const text = applyEdit(SOURCE, addZone(read(SOURCE), SOURCE, { x: 400, y: 40 }, '社内 LAN'));
    expect(text).toContain('group zone1 "社内 LAN" {');
    const laid = layOutDiagram(read(text), 'ja');
    expect(laid.boxes.get('zone1')).toMatchObject({ width: 320, height: 200 });
  });
});
