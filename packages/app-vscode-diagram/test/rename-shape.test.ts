// F2 on a shape's name in the text of a drawing.

import { describe, expect, it } from 'vitest';
import { registerShapeRename } from '../src/rename-shape.js';
import { documentAt, give, Position, renamers, type WorkspaceEdit } from './fake-vscode.js';

const DRAWING = ['free {', '  a [A]', '  b [B]', '  a --> b', '}', 'layout {', '  a @ (0, 0)', '}', ''].join('\n');

interface Renamer {
  prepareRename(document: unknown, position: unknown): { placeholder: string };
  provideRenameEdits(document: unknown, position: unknown, name: string): Promise<WorkspaceEdit>;
}

describe('F2 で図形の名前を変える', () => {
  it('名前の上なら、線や配置ごと書き換える。既にある名前は断る', async () => {
    give({ 'd.dgm': DRAWING });
    registerShapeRename();
    const renamer = renamers.at(-1)!.provider as Renamer;
    const document = await documentAt('d.dgm');
    const on = new Position(1, 2);
    expect(renamer.prepareRename(document, on).placeholder).toBe('a');
    const edit = await renamer.provideRenameEdits(document, on, 'start');
    const change = edit.changes[0]!;
    const text = document.getText().slice(0, document.offsetAt(change.range.start)) + change.text
      + document.getText().slice(document.offsetAt(change.range.end));
    expect(text).toContain('start [A]');
    expect(text).toContain('start --> b');
    expect(text).toContain('start @ (0, 0)');
    await expect(renamer.provideRenameEdits(document, on, 'b')).rejects.toThrow('b');
    // 図形の名前でない所では始めない
    expect(() => renamer.prepareRename(document, new Position(0, 1))).toThrow();
  });
});
