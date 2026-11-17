// Putting the picked shapes into a new stack.

import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import { DiagramEditError, layOutDiagram, parseDiagram, stackNodes } from '../src/index.js';

const boxesOf = (text: string) => {
  const laid = layOutDiagram(parseDiagram(text));
  return new Map([...laid.boxes].map(([id, box]) => [id, { ...box, x: box.x - laid.origin.x, y: box.y - laid.origin.y }]));
};
const stack = (text: string, ids: string[], flow: 'down' | 'right') =>
  applyEdit(text, stackNodes(parseDiagram(text), text, ids, flow, boxesOf(text)));

describe('手で置いた図形を並べる', () => {
  const FREE = [
    'free {', '  a [A]', '  b [B]', '  c [C]', '}', '',
    'layout {', '  a @ (100, 200) 80x40', '  b @ (40, 60) 80x40', '  c @ (300, 300) 80x40', '}', '',
  ].join('\n');

  it('画面の上から順に縦に並べ、ピンはまとめた stack 1 つになる', () => {
    const text = stack(FREE, ['a', 'b'], 'down');
    expect(text).toContain('  stack1 ""');
    expect(text).toContain('stack stack1 (down; pad: 0) {\n    b\n    a\n  }');
    expect(text).toMatch(/stack1 @ \(40, 60\)\n/);
    expect(text).not.toMatch(/^\s+a\s+@/m);
    expect(text).not.toMatch(/^\s+b\s+@/m);
    expect(text).toContain('c @ (300, 300) 80x40');
    const laid = layOutDiagram(parseDiagram(text));
    expect(laid.boxes.get('a')!.y).toBeGreaterThan(laid.boxes.get('b')!.y);
    expect(laid.diagnostics).toEqual([]);
  });

  it('横に並べるときは左から順', () => {
    const text = stack(FREE, ['a', 'b', 'c'], 'right');
    expect(text).toContain('stack stack1 (right; pad: 0) {\n    b\n    a\n    c\n  }');
    const laid = layOutDiagram(parseDiagram(text));
    expect(laid.boxes.get('a')!.x).toBeGreaterThan(laid.boxes.get('b')!.x);
    expect(laid.boxes.get('c')!.x).toBeGreaterThan(laid.boxes.get('a')!.x);
  });
});

describe('入れ物の中の図形を並べる（入れ子になる）', () => {
  const HELD = [
    'free {', '  frame [ ]', '  a [A]', '  b [B]', '  c [C]', '  d [D]', '}', '',
    'layout {', '  frame @ (0, 0) 400x400',
    '  stack frame (down) {', '    a', '    b', '    c', '    d', '  }', '}', '',
  ].join('\n');

  it('最初の 1 つの場所に新しい stack が入り、ほかは並びから抜ける', () => {
    const text = stack(HELD, ['b', 'c'], 'right');
    expect(text).toContain('stack frame (down) {\n    a\n    stack1\n    d\n  }');
    expect(text).toContain('stack stack1 (right; pad: 0) {\n    b\n    c\n  }');
    expect(text).not.toContain('stack1 @');
    const laid = layOutDiagram(parseDiagram(text));
    expect(laid.boxes.get('b')!.y).toBe(laid.boxes.get('c')!.y);
    expect(laid.diagnostics).toEqual([]);
  });

  it('格子の中なら、抜けたセルは空きとして残る', () => {
    const grid = HELD.replace('stack frame (down) {\n    a\n    b\n    c\n    d\n  }', 'grid frame {\n    a ; b\n    c ; d\n  }');
    const text = stack(grid, ['a', 'c'], 'down');
    const cells = parseDiagram(text).containers.get('frame')!.cells;
    expect(cells).toEqual([['stack1', 'b'], ['.', 'd']]);
  });

  it('入れ物の中と外は一緒に並べない', () => {
    const mixed = HELD.replace('  frame @ (0, 0) 400x400', '  frame @ (0, 0) 400x400\n  e @ (500, 0) 80x40').replace('  d [D]', '  d [D]\n  e [E]');
    expect(() => stack(mixed, ['a', 'e'], 'down')).toThrow(DiagramEditError);
  });
});
