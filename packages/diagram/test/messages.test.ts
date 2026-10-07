import { describe, expect, it } from 'vitest';
import { checkMessages, describeError, localizeEdit } from '@docpresenter/base';
import { DIAGRAM_MESSAGES, parseDiagram, pinNode, stencilParts } from '../src/index.js';

describe('diagram messages', () => {
  it('has every Japanese key in English, with the same placeholders', () => {
    expect(checkMessages(DIAGRAM_MESSAGES)).toEqual([]);
  });

  it('has a name for every picture shipped with the tool', () => {
    for (const part of stencilParts('en')) {
      expect(part.label).not.toMatch(/^diagram\./);
      expect(part.group).not.toMatch(/^diagram\./);
    }
    expect(stencilParts('en').find(part => part.name === 'net/router')?.label).toBe('Router');
    expect(stencilParts().find(part => part.name === 'net/router')?.label).toBe('ルータ');
  });

  it('says a parse error in either language, Japanese by default', () => {
    let caught: unknown;
    try { parseDiagram('flow {\n  ???\n}\n'); } catch (error) { caught = error; }
    expect((caught as Error).message).toBe('解釈できない行: ???（2 行目）');
    expect(describeError(caught, 'en')).toBe('Cannot read this line: ??? (line 2)');
  });

  it('names an edit by id, so the view can say it in English', () => {
    const source = 'flow {\n  a[A]\n}\n';
    const edit = pinNode(parseDiagram(source), source, 'a', { x: 0, y: 0 });
    expect(edit.phrase?.id).toBe('diagram.did.pin');
    expect(edit.description).toBe('配置を固定');
    expect(localizeEdit(edit, 'en').description).toBe('Pin the placement');
  });
});
