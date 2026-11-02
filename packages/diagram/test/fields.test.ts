import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import {
  addField, addLabel, fieldOf, fieldShapes, formOf, itemName, labelSide, layOutDiagram, moveFormRow,
  editBetween, parseDiagram, setLabelColumn, setLabelSide, withLibrary, withParts,
} from '../src/index.js';

// A login form, labels on top: the way the sample screen is drawn.
const TOP = [
  'use "default"',
  '',
  'free {',
  '  frame    frame:',
  '  title    title:"ログイン"',
  '  idField  ""',
  '  idLabel  label:"ログイン ID"',
  '  idBox    textbox:',
  '  keepRow  ""',
  '  keepBox  checkbox:',
  '  keepText label:"保持する"',
  '  submit   primary:"ログイン"',
  '}',
  '',
  'layout {',
  '  frame @ (40, 20) 380x420',
  '  stack frame (down; gap: 20; pad: 30) { title ; idField ; keepRow ; submit }',
  '  stack idField (down; gap: 2; pad: 0) { idLabel ; idBox }',
  '  stack keepRow (right; gap: 8; pad: 0) { keepBox ; keepText }',
  '}',
  '',
].join('\n');

const read = (source: string, library?: string) =>
  withParts(parseDiagram(source), path => (path === 'mine.dgm' ? library : undefined));

/** The drawing after an edit, read again — and laid out, so a broken file fails here. */
const after = (source: string, edit: { span: { start: number; end: number }; text: string }) => {
  const text = applyEdit(source, edit as never);
  const file = read(text);
  expect(layOutDiagram(file).notes.filter(note => note.id.startsWith('diagram.arrange'))).toEqual([]);
  return { text, file };
};

describe('a field: an input and its label', () => {
  it('knows the field of an input, of its label, and of a check box', () => {
    const file = read(TOP);
    expect(fieldOf(file, 'idBox')).toMatchObject({ kind: 'top', item: 'idBox', label: 'idLabel', container: 'idField' });
    expect(fieldOf(file, 'idLabel')?.item).toBe('idBox');
    expect(fieldOf(file, 'keepBox')).toMatchObject({ kind: 'row', label: 'keepText' });
    expect(fieldOf(file, 'submit')).toBeUndefined();
    expect(formOf(file, 'idBox')?.id).toBe('frame');
    expect(fieldShapes(file, 'idBox')).toEqual(['idLabel', 'idBox', 'idField']);
    expect(fieldShapes(file, 'submit')).toEqual(['submit']);
  });

  it('adds a field under the picked one, the label first', () => {
    const file = read(TOP);
    const added = addField(file, TOP, { part: 'textbox', label: 'パスワード', near: 'idBox' });
    const { text, file: next } = after(TOP, added.edit);
    expect(text).toContain('stack frame (down; gap: 20; pad: 30) { title ; idField ; textbox1Field ; keepRow ; submit }');
    expect(text).toContain('stack textbox1Field (down; gap: 2; pad: 0) { textbox1Label ; textbox1 }');
    expect(text).toContain('textbox1Label label:"パスワード"');
    expect(itemName(next, 'textbox1')).toBe('パスワード');
  });

  it('adds a check box with its words after it', () => {
    const added = addField(read(TOP), TOP, { part: 'checkbox', label: '同意する', near: 'keepBox' });
    const { text, file } = after(TOP, added.edit);
    expect(text).toContain('stack checkbox1Field (right; gap: 8; pad: 0) { checkbox1 ; checkbox1Label }');
    expect(itemName(file, 'checkbox1')).toBe('同意する');
  });

  it('pins a field where it is put when nothing is picked, as wide as the input', () => {
    const added = addField(read(TOP), TOP, { part: 'textbox', label: 'メモ', at: { x: 500, y: 40 } });
    const { text, file } = after(TOP, added.edit);
    expect(text).toMatch(/textbox1Field +@ \(500, 40\) 320x54/);
    expect(itemName(file, 'textbox1')).toBe('メモ');
  });

  it('gives an input in a field of its own a label over it', () => {
    const source = TOP.replace('{ title ; idField ; keepRow ; submit }', '{ title ; idField ; mail ; keepRow ; submit }')
      .replace('  submit   primary:"ログイン"', '  mail     textbox:\n  submit   primary:"ログイン"');
    const added = addLabel(read(source), source, 'mail', 'メール');
    const { text, file } = after(source, added.edit);
    expect(text).toContain('{ title ; idField ; mailField ; keepRow ; submit }');
    expect(text).toContain('stack mailField (down; gap: 2; pad: 0) { mailLabel ; mail }');
    expect(itemName(file, 'mail')).toBe('メール');
    expect(() => addLabel(read(TOP), TOP, 'idBox', 'x')).toThrow();
  });
});

describe('labels on the left', () => {
  const left = () => {
    const edit = setLabelSide(read(TOP), TOP, 'idBox', 'left');
    return after(TOP, edit);
  };

  it('turns a form of fields into a grid, a label and an input to a row', () => {
    const { text, file } = left();
    expect(text).toContain([
      '  grid frame (cols: auto, 1fr; gap: 20 12; pad: 30) {',
      '    title ; title',
      '    idLabel ; idBox',
      '    . ; keepRow',
      '    submit ; submit',
      '  }',
    ].join('\n'));
    // The field's stack and its shape are gone; nothing that is drawn is.
    expect(text).not.toContain('idField');
    expect(fieldOf(file, 'idBox')).toMatchObject({ kind: 'left', label: 'idLabel', container: 'frame', row: 1 });
    expect(itemName(file, 'idBox')).toBe('ログイン ID');
  });

  it('starts every input at the same place, the label column as wide as the longest label', () => {
    const { file } = left();
    const laid = layOutDiagram(file);
    const label = laid.boxes.get('idLabel')!;
    const box = laid.boxes.get('idBox')!;
    expect(box.x).toBe(laid.boxes.get('keepRow')!.x);
    // As wide as "ログイン ID", not the 320 the library gives a label.
    expect(label.width).toBeLessThan(120);
  });

  it('turns back into fields on top, with names of their own', () => {
    const { text } = left();
    const back = setLabelSide(read(text), text, 'idBox', 'top');
    const { text: again, file } = after(text, back);
    expect(again).toContain('stack frame (down; gap: 20; pad: 30) {');
    expect(again).toContain('stack idField (down; gap: 2; pad: 0) { idLabel ; idBox }');
    expect(fieldOf(file, 'idBox')?.kind).toBe('top');
  });

  it('adds a row under the picked one, and moves rows', () => {
    const { text } = left();
    const added = addField(read(text), text, { part: 'textbox', label: 'パスワード', near: 'idLabel' });
    const { text: more, file } = after(text, added.edit);
    expect(more).toContain('    idLabel ; idBox\n    textbox1Label ; textbox1\n');
    expect(itemName(file, 'textbox1')).toBe('パスワード');
    const moved = after(more, moveFormRow(file, more, 'frame', 2, 1)).text;
    expect(moved).toContain('    title ; title\n    textbox1Label ; textbox1\n    idLabel ; idBox\n');
  });

  it('sets the width of the label column, and gives it back to the labels', () => {
    const { text } = left();
    const fixed = after(text, setLabelColumn(read(text), text, 'frame', 120)).text;
    expect(fixed).toContain('grid frame (cols: 120, 1fr; gap: 20 12; pad: 30) {');
    const auto = after(fixed, setLabelColumn(read(fixed), fixed, 'frame', 'auto')).text;
    expect(auto).toContain('grid frame (cols: auto, 1fr;');
  });

  it('takes the side for a new form from the library', () => {
    const library = 'use "default"\n\nparts {\n  label "" { color: #333333, field: left } 320x18\n}\n';
    const source = 'use "mine.dgm"\n\nfree {\n  frame frame:\n}\n\nlayout {\n  frame @ (0, 0) 300x200\n}\n';
    const file = read(source, library);
    expect(labelSide(file)).toBe('left');
    const added = addField(file, source, { part: 'textbox', label: '氏名', at: { x: 10, y: 10 } });
    const text = applyEdit(source, added.edit);
    expect(text).toContain('grid textbox1Form (cols: auto, 1fr; gap: 12 12; pad: 0) { textbox1Label ; textbox1 }');
  });
});

describe('a hint under an input', () => {
  it('goes under the input in a form on the left, and back into its field on top', () => {
    const source = TOP
      .replace('  idBox    textbox:', '  idBox    textbox:\n  idHint   hint:"社員番号"')
      .replace('{ idLabel ; idBox }', '{ idLabel ; idBox ; idHint }');
    const left = applyEdit(source, setLabelSide(read(source), source, 'idBox', 'left'));
    expect(left).toContain('    idLabel ; idBox\n    . ; idHint\n');
    const back = applyEdit(left, setLabelSide(read(left), left, 'idBox', 'top'));
    expect(back).toContain('stack idField (down; gap: 2; pad: 0) { idLabel ; idBox ; idHint }');
    expect(back).toMatch(/stack frame \(down; gap: 20; pad: 30\) \{\n\s+title\n\s+idField\n\s+keepRow\n\s+submit\n\s+\}/);
  });
});

describe('a screen drawn with no parts library', () => {
  it('takes the shipped library with the first part put on it, as one change', () => {
    const source = '# 画面\n\nfree {\n  frame [ ]\n}\n\nlayout {\n  frame @ (0, 0) 380x300\n}\n';
    const text = withLibrary(source, 'default');
    expect(text.startsWith('# 画面\n\nuse "default"\n\nfree {')).toBe(true);
    const drawing = withParts(parseDiagram(text), () => undefined);
    const added = addField(drawing, text, { part: 'textbox', label: '氏名', at: { x: 10, y: 10 } });
    const edit = editBetween(source, applyEdit(text, added.edit), added.edit.phrase!);
    const written = applyEdit(source, edit);
    expect(written).toContain('use "default"');
    expect(written).toContain('textbox1 textbox:');
    expect(itemName(withParts(parseDiagram(written), () => undefined), 'textbox1')).toBe('氏名');
  });
});
