import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import { duplicateNodes, layOutDiagram, parseDiagram, withParts } from '../src/index.js';

const copy = (source: string, ids: string[], offset = { x: 20, y: 20 }) => {
  const file = withParts(parseDiagram(source), () => undefined);
  const laid = layOutDiagram(file);
  const places = new Map([...laid.boxes].map(([id, box]) =>
    [id, { ...box, x: box.x - laid.origin.x, y: box.y - laid.origin.y }]));
  const made = duplicateNodes(file, source, { file, source, ids, places }, offset);
  const text = applyEdit(source, made.edit);
  return { text, ids: made.ids, file: parseDiagram(text) };
};

describe('図形の複製', () => {
  const FREE = [
    'free {',
    '  box1 [申請]',
    '  box2 [承認]',
    '  box3 [却下]',
    '  box1 --> box2 "OK"',
    '  box1 --> box3',
    '}',
    '',
    'layout {',
    '  box1 @ (10, 10) 120x40',
    '  box2 @ (200, 10)',
    '  box3 @ (200, 100)',
    '}',
    '',
    'style {',
    '  box1 { fill: #e3f2fd }',
    '}',
    '',
  ].join('\n');

  it('名前を変えて、位置をずらして、見た目と選んだもの同士をつなぐ線ごと写す', () => {
    const { text, ids, file } = copy(FREE, ['box1', 'box2']);
    expect(ids).toEqual(['box4', 'box5']);
    expect(text).toContain('  box4 [申請]');
    expect(text).toContain('  box5 [承認]');
    expect(text).toContain('box4 --> box5 "OK"');
    // Not copied: the line to a shape that was left behind.
    expect(file.edges.filter(edge => edge.from === 'box4')).toHaveLength(1);
    expect(file.layout.get('box4')).toMatchObject({ x: 30, y: 30, width: 120, height: 40 });
    expect(file.layout.get('box5')).toMatchObject({ x: 220, y: 30 });
    expect(file.style.get('box4')?.get('fill')).toBe('#e3f2fd');
    // The originals are as they were.
    expect(file.layout.get('box1')).toMatchObject({ x: 10, y: 10 });
  });

  it('入れ物はその中身ごと写し、中身の名前も入れ物の中で書き換える', () => {
    const source = [
      'free {',
      '  field1 ""',
      '  label1 "氏名"',
      '  input1 [ ]',
      '}',
      '',
      'layout {',
      '  field1 @ (0, 0) 200x60',
      '  stack field1 (down; gap: 2; pad: 0) {',
      '    label1',
      '    input1',
      '  }',
      '}',
      '',
    ].join('\n');
    const { text, ids, file } = copy(source, ['field1'], { x: 0, y: 80 });
    expect(ids).toEqual(['field2']);
    expect(text).toContain('stack field2 (down; gap: 2; pad: 0) {\n    label2\n    input2\n  }');
    expect(file.containers.get('field2')?.cells.flat()).toEqual(['label2', 'input2']);
    expect(file.layout.get('field2')).toMatchObject({ x: 0, y: 80 });
    expect(file.layout.has('label2')).toBe(false);
  });
});
