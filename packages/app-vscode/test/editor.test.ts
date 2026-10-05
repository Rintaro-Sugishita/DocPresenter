import { describe, expect, it } from 'vitest';
import { applyEdit, type Edit } from '@docpresenter/base';
import { runBuild } from '../src/build-command.js';
import { SheetEditorProvider } from '../src/sheet-editor.js';
import type { FromView, ToView } from '../src/protocol.js';
import { documentAt, give, held, saved, written } from './fake-vscode.js';

const DOC = [
  '# 認証機能 設計書',
  '',
  '最初の段落。',
  '',
  '@import "auth/login.dgm" #fig-login "ログイン画面"',
  '',
].join('\n');
const DGM = ['free {', '  a [あ]', '}', '', 'layout {', '  a @ (10, 20)', '}', ''].join('\n');

/** Opens the editor on a document and gives the test the two directions. */
async function open(files: Readonly<Record<string, string>> = { 'docs/design.md': DOC, 'docs/auth/login.dgm': DGM }) {
  give(files);
  const sent: ToView[] = [];
  let receive: ((message: FromView) => unknown) | undefined;
  const panel = {
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (uri: { toString(): string }) => uri,
      postMessage: (message: ToView) => { sent.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: (listen: (message: FromView) => unknown) => {
        receive = listen;
        return { dispose: () => undefined };
      },
    },
    onDidDispose: () => ({ dispose: () => undefined }),
  };
  const document = await documentAt('docs/design.md');
  const provider = new SheetEditorProvider(
    { extensionUri: { toString: () => 'file:///ext' } } as never);
  await provider.resolveCustomTextEditor(document as never, panel as never, {} as never);
  return {
    sent, document,
    html: () => panel.webview.html,
    say: async (message: FromView) => { await receive?.(message); },
  };
}

describe('VS Code のカスタムエディタ', () => {
  it('開くと、文書と作業場のファイルが画面に渡る', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    const opened = view.sent.find(one => one.kind === 'open');
    expect(opened?.kind).toBe('open');
    if (opened?.kind !== 'open') return;
    expect(opened.path).toBe('docs/design.md');
    expect(opened.source).toBe(DOC);
    // 図のファイルも一緒に渡る。読み込みは同期で聞かれるので、後から取りには行けない。
    expect(opened.files['docs/auth/login.dgm']).toBe(DGM);
    expect(opened.commitKey).toBe('ctrl-enter');
  });

  // 画面はこの拡張のスクリプトだけを動かす。設計書の中身を読み込む画面が、
  // どこへでも繋げる画面であってはならない。
  it('画面は拡張のスクリプトしか動かさない（CSP）', async () => {
    const view = await open();
    const html = view.html();
    expect(html).toContain("default-src 'none'");
    expect(/script-src 'nonce-[A-Za-z0-9]{32}'/.test(html)).toBe(true);
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).not.toContain('http://');
  });

  // 編集は「全文を書き戻す」ではなく「言われたバイト範囲を置き換える」。
  // ここが崩れると、1 文字直しただけで差分がファイル全体になる。
  it('文書の編集は、言われたバイト範囲だけを書き換える', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    const at = DOC.indexOf('最初の段落。');
    const span = {
      start: new TextEncoder().encode(DOC.slice(0, at)).length,
      end: new TextEncoder().encode(DOC.slice(0, at + '最初の段落。'.length)).length,
    };
    await view.say({
      kind: 'change', span, description: '段落を書き換える', text: '直した段落。',
    });
    expect(view.document.getText()).toBe(DOC.replace('最初の段落。', '直した段落。'));
    // 文書そのものは VS Code の流儀に任せる——タブの点が見えているので。
    expect(saved).not.toContain('docs/design.md');
  });

  it('図のファイルの編集は、そのファイルに書かれ、保存まで済む', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    const edit: Edit = {
      span: { start: DGM.indexOf('[あ]'), end: DGM.indexOf('[あ]') + 5 },
      text: '[い]', description: '文字を変更',
    };
    await view.say({
      kind: 'change', path: 'docs/auth/login.dgm',
      span: edit.span, description: edit.description, text: edit.text,
    });
    expect(held.get('docs/auth/login.dgm')).toBe(applyEdit(DGM, edit));
    // 開いていないファイルが「未保存」のまま残るのは、誰にも見えない状態である
    expect(saved).toContain('docs/auth/login.dgm');
  });

  it('新しい図のファイルは、作業場に書かれる', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    await view.say({ kind: 'create', path: 'docs/design/diagram-1.dgm', text: 'free {\n}\n' });
    expect(new TextDecoder().decode(written.get('docs/design/diagram-1.dgm'))).toBe('free {\n}\n');
  });

  // ほかの誰かが同じファイルを書き換えたら、画面は古いものを映していることになる。
  it('外から書き換えられたら、画面に知らせる', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    const other = await documentAt('docs/auth/login.dgm');
    other.replace(
      { start: other.positionAt(0), end: other.positionAt(0) } as never, '# 外からの追記\n');
    const told = view.sent.filter(one => one.kind === 'file');
    expect(told.length).toBe(1);
    expect(told[0]?.kind === 'file' && told[0].path).toBe('docs/auth/login.dgm');
  });

  it('自分が書いた変更は、画面に送り返さない（下で勝手に描き直さない）', async () => {
    const view = await open();
    await view.say({ kind: 'ready' });
    await view.say({
      kind: 'change', path: 'docs/auth/login.dgm',
      span: { start: 0, end: 0 }, description: '図形を追加', text: '# 足した\n',
    });
    expect(view.sent.filter(one => one.kind === 'file').length).toBe(0);
  });
});

describe('ビルドのコマンド', () => {
  // ビルドはファイルを 1 つも開かない作りなので、CLI と同じものがそのまま動く。
  // 確かめたいのは「VS Code のファイルシステム越しでも同じ結果になる」ことである。
  it('作業場を読んで、成果物を作業場に書く', async () => {
    give({
      'docs/design.md': ['---', 'title: 試し', 'output: [html]', '---', '',
        '# 試し', '', '本文。', ''].join('\n'),
    });
    const output = { lines: [] as string[], clear() { this.lines.length = 0; }, show() {},
      appendLine(line: string) { this.lines.push(line); }, dispose() {} };
    await runBuild(output as never, ':root { --dp-text: #000 }');
    const made = [...written.keys()];
    expect(made).toContain('out/build/design.html');
    expect(new TextDecoder().decode(written.get('out/build/design.html'))).toContain('試し');
    expect(output.lines.join('\n')).toContain('成果物 1 件');
  });

  it('PDF は書けないと、黙らずに言う', async () => {
    give({
      'docs/design.md': ['---', 'title: 試し', 'output: [html, pdf]', '---', '',
        '# 試し', ''].join('\n'),
    });
    const output = { lines: [] as string[], clear() { this.lines.length = 0; }, show() {},
      appendLine(line: string) { this.lines.push(line); }, dispose() {} };
    await runBuild(output as never, ':root { --dp-text: #000 }');
    expect(output.lines.join('\n')).toContain('PDF はこの版では書けません');
    // 書けないものを黙って落とさない。HTML は出る。
    expect([...written.keys()]).toContain('out/build/design.html');
  });
});
