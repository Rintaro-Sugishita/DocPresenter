// The canvas in VS Code: it is handed the drawing and the libraries it uses,
// each gesture comes back as one byte range of the file, and a change made
// elsewhere draws it again.

import { describe, expect, it, vi } from 'vitest';
import { byteLength } from '@docpresenter/base';
import { CanvasEditorProvider } from '../src/canvas-editor.js';
import type { FromCanvas, ToCanvas } from '../src/protocol.js';
import { documentAt, give, held, Uri, window, workspace } from './fake-vscode.js';

const DGM = ['use "../shared/parts.dgm"', 'free {', '  ok   button:"送信"', '  会員 [会員]', '}', ''].join('\n');
const PARTS = 'parts {\n  button ( ) { fill: #2f6fb5 } 120x40\n}\n';

async function open() {
  give({ 'docs/login.dgm': DGM, 'shared/parts.dgm': PARTS });
  const sent: ToCanvas[] = [];
  const revealed: unknown[] = [];
  let receive: ((message: FromCanvas) => unknown) | undefined;
  const panel = {
    webview: {
      options: {}, html: '', cspSource: 'vscode-webview:',
      asWebviewUri: (uri: { toString(): string }) => uri,
      postMessage: (message: ToCanvas) => { sent.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: (listen: (message: FromCanvas) => unknown) => {
        receive = listen;
        return { dispose: () => undefined };
      },
    },
    onDidDispose: () => ({ dispose: () => undefined }),
    reveal: (...how: unknown[]) => { revealed.push(how); },
  };
  const document = await documentAt('docs/login.dgm');
  await new CanvasEditorProvider(Uri.file('/ext')).resolveCustomTextEditor(document as never, panel as never);
  return { sent, revealed, document, html: () => panel.webview.html, say: async (message: FromCanvas) => { await receive?.(message); } };
}

describe('キャンバス', () => {
  it('図と、図が使う部品のファイルが画面に渡る', async () => {
    const view = await open();
    expect(view.html()).toContain('canvas.js');
    await view.say({ kind: 'ready' });
    expect(view.sent).toEqual([{
      kind: 'open', source: DGM, libraries: { '../shared/parts.dgm': PARTS }, locale: 'ja',
    }]);
  });

  it('編集はバイト範囲のまま、その範囲だけが書き換わる', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    // 日本語の後ろの範囲：バイトと UTF-16 の数え方の違いで位置がずれない。
    const at = byteLength(DGM.slice(0, DGM.indexOf('[会員]')));
    await view.say({ kind: 'edit', start: at, end: at + byteLength('[会員]'), text: '[利用者]', base: DGM });
    expect(held.get('docs/login.dgm')).toBe(DGM.replace('[会員]', '[利用者]'));
    // 自分の書いた変更では描き直さない。
    expect(view.sent).toHaveLength(1);
  });

  it('古い文に対する編集は書かず、今の文を渡し直す', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    await view.say({ kind: 'edit', start: 0, end: 0, text: '# x\n', base: 'free {\n}\n' });
    expect(held.get('docs/login.dgm')).toBe(DGM);
    expect(view.sent.map(one => one.kind)).toEqual(['open', 'update']);
  });

  it('ほかで書き換えられたら、描き直す', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    const edit = new (await import('./fake-vscode.js')).WorkspaceEdit();
    edit.insert(view.document.uri, view.document.positionAt(0), '# 説明\n');
    await workspace.applyEdit(edit);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(view.sent.map(one => one.kind)).toEqual(['open', 'update']);
    expect(view.sent[1]!.source).toBe(`# 説明\n${DGM}`);
  });

  it('テキスト側で打つたびに描き直しても、画面を前に出さない', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    const shown = vi.spyOn(window, 'showTextDocument');
    const { WorkspaceEdit } = await import('./fake-vscode.js');
    for (const letter of ['#', ' ', 'x']) {
      const edit = new WorkspaceEdit();
      edit.insert(view.document.uri, view.document.positionAt(0), letter);
      await workspace.applyEdit(edit);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(view.sent.map(one => one.kind)).toEqual(['open', 'update', 'update', 'update']);
    expect(view.sent[3]!.source).toBe(`x #${DGM}`);
    // フォーカスは打っているテキストエディタに残る。
    expect(view.revealed).toEqual([]);
    expect(shown).not.toHaveBeenCalled();
    shown.mockRestore();
  });
});
