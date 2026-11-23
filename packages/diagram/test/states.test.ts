// What a control on a screen is showing: ticked or not, usable or not, and
// words in a size and typeface of their own.

import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import {
  checkState, fontOf, isDisabled, layOutDiagram, parseDiagram, renderDiagram, setEnabled, toggleCheck, withParts,
} from '../src/index.js';

const LIST = [
  'use "default"',
  '',
  'free {',
  '  results  grid:',
  '  pickHead label:"選択"',
  '  pick1    checkbox:',
  '  pick2    checkbox:',
  '  mark     [ ]',
  '  send     primary:"送信"',
  '}',
  '',
  'layout {',
  '  results @ (20, 20) 200x120',
  '  mark    @ (20, 200) 16x16',
  '  send    @ (20, 240) 100x32',
  '  grid results (cols: pick 1fr) {',
  '    pickHead',
  '    pick1',
  '    pick2',
  '  }',
  '}',
  '',
  'style {',
  '  mark { icon: ui/radio }',
  '}',
  '',
].join('\n');

const load = (source: string) => withParts(parseDiagram(source), () => undefined);

describe('ticking a check box', () => {
  it('ticks one row of a column, as the library\'s other part', () => {
    const file = load(LIST);
    expect(checkState(file, 'pick1')).toBe('off');
    const once = applyEdit(LIST, toggleCheck(file, LIST, 'pick2'));
    expect(once).toContain('  pick2    checked:');
    expect(once).toContain('  pick1    checkbox:');
    expect(checkState(load(once), 'pick2')).toBe('on');
    const back = applyEdit(once, toggleCheck(load(once), once, 'pick2'));
    expect(back).toBe(LIST);
  });

  it('changes the picture of a shape that is not a part', () => {
    const file = load(LIST);
    const on = applyEdit(LIST, toggleCheck(file, LIST, 'mark'));
    expect(on).toContain('mark { icon: ui/radio-on }');
    expect(checkState(load(on), 'mark')).toBe('on');
  });

  it('refuses a shape that is neither', () => {
    expect(() => toggleCheck(load(LIST), LIST, 'send')).toThrow();
    expect(checkState(load(LIST), 'send')).toBeUndefined();
  });
});

describe('a control that cannot be used', () => {
  it('is written enabled: false, and drawn in the library\'s disabled look over its part', () => {
    const off = applyEdit(LIST, setEnabled(LIST, 'send', false));
    expect(off).toContain('send { enabled: false }');
    const file = load(off);
    expect(isDisabled(file.style.get('send'))).toBe(true);
    // The default library's look, over the button's own colours.
    expect(file.style.get('send')?.get('fill')).toBe('#f2f3f5');
    expect(file.style.get('send')?.get('color')).toBe('#9aa0a8');
    const svg = renderDiagram(file);
    expect(svg).toMatch(/class="[^"]*dp-disabled[^"]*" data-node="send"/);
    // Usable again: the line goes.
    expect(applyEdit(off, setEnabled(off, 'send', true))).toBe(LIST);
  });

  it('fades a picture, and takes a disabled part of the screen\'s own', () => {
    const own = LIST.replace('free {', 'parts {\n  disabled "" { fill: #eeeeee, opacity: 0.3, item: 入力 }\n}\n\nfree {')
      .replace('  mark { icon: ui/radio }', '  mark { icon: ui/radio }\n  pick1 { enabled: false }\n  send { enabled: no }');
    const file = load(own);
    expect(file.style.get('pick1')?.get('opacity')).toBe('0.3');
    expect(file.style.get('send')?.get('fill')).toBe('#eeeeee');
    // What is not a look is not handed on.
    expect(file.style.get('send')?.get('item')).toBe('操作');
    const plain = load(LIST.replace('  mark { icon: ui/radio }', '  mark { icon: ui/radio, enabled: false }'));
    expect(plain.style.get('mark')?.get('opacity')).toBe('0.45');
    expect(renderDiagram(plain)).toContain('opacity:0.45');
  });
});

describe('words in a size and typeface of their own', () => {
  const FLOW = 'flow {\n  a [見出し]\n  b [本文]\n  a --> b\n}\n\nstyle {\n  a { font-size: 24, font: "Yu Gothic" }\n}\n';

  it('reads the size and the typeface, and ignores what is not one', () => {
    expect(fontOf(new Map([['font-size', '18px'], ['font', "'Meiryo'"]]))).toEqual({ size: 18, family: 'Meiryo' });
    expect(fontOf(new Map([['font-size', 'big'], ['font', 'a;b']]))).toEqual({ size: undefined, family: undefined });
    expect(fontOf(new Map([['font-size', '400']])).size).toBeUndefined();
  });

  it('measures the words at their size and draws them in it', () => {
    const file = parseDiagram(FLOW);
    const laid = layOutDiagram(file);
    expect(laid.boxes.get('a')!.width).toBeGreaterThanOrEqual(laid.boxes.get('b')!.width);
    const svg = renderDiagram(file);
    expect(svg).toContain(`style="font-size:24px;font-family:'Yu Gothic'"`);
  });
});
