// Reading a deck back from VS Code: what is written, how small, and what is
// refused because the drawing changed after it was read.

import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { build, type Workspace } from '@docpresenter/build';
import { difference, readBackDeck } from '../src/pptx-back-command.js';
import { documentAt, give, held, picks, saved, shown, Uri, written } from './fake-vscode.js';

const DOC = '---\ntitle: T\noutput: [pptx]\n---\n\n# A\n\n@import "flow.dgm" {#fig-flow}\n';
const DGM = 'flow {\n  a [開始]\n  b [ホーム]\n  a --> b\n}\n';
const THEME = 'body { color: #000 }\n';

/** The deck the build makes of the sample, with `from` retyped as `to` in its slide. */
async function editedDeck(from: string, to: string): Promise<Uint8Array> {
  const files: Record<string, string> = { 'docs/a.md': DOC, 'docs/flow.dgm': DGM, 'themes/default/theme.css': THEME };
  const workspace: Workspace = { list: () => Object.keys(files), read: path => files[path], dataUrl: () => undefined };
  const pptx = (await build(workspace)).artifacts.find(one => one.format === 'pptx')!.bytes!;
  const parts = unzipSync(pptx);
  const slide = Object.keys(parts).find(name =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name) && strFromU8(parts[name]!).includes('flow.dgm'))!;
  parts[slide] = strToU8(strFromU8(parts[slide]!).replace(from, to));
  return zipSync(parts);
}

const output = () => ({
  lines: [] as string[],
  clear() { this.lines.length = 0; },
  show() { /* 画面は無い */ },
  appendLine(line: string) { this.lines.push(line); },
});

describe('PPTX の修正を図に読み戻すコマンド', () => {
  it('選んだ図に、変わった範囲だけを書き戻して保存する', async () => {
    give({ 'docs/a.md': DOC, 'docs/flow.dgm': DGM, 'themes/default/theme.css': THEME });
    written.set('out/build/a.pptx', await editedDeck('<a:t>ホーム</a:t>', '<a:t>マイページ</a:t>'));
    const said = output();
    await readBackDeck(said, Uri.file('/w/out/build/a.pptx'));
    expect(held.get('docs/flow.dgm')).toBe(DGM.replace('[ホーム]', '[マイページ]'));
    expect(saved).toContain('docs/flow.dgm');
    expect(said.lines.join('\n')).toContain('-   b [ホーム]');
    expect(said.lines.join('\n')).toContain('+   b [マイページ]');
    expect(shown.some(message => message.includes('1 個の図に書き戻しました'))).toBe(true);
  });

  it('選ばなければ何も書かない', async () => {
    give({ 'docs/a.md': DOC, 'docs/flow.dgm': DGM, 'themes/default/theme.css': THEME });
    written.set('out/build/a.pptx', await editedDeck('<a:t>ホーム</a:t>', '<a:t>マイページ</a:t>'));
    picks.quick = () => [];
    await readBackDeck(output(), Uri.file('/w/out/build/a.pptx'));
    expect(held.get('docs/flow.dgm')).toBe(DGM);
  });

  it('ダイアログで選んだ PPTX も読める。変更が無ければそう言う', async () => {
    give({ 'docs/a.md': DOC, 'docs/flow.dgm': DGM, 'themes/default/theme.css': THEME });
    written.set('out/build/a.pptx', await editedDeck('nothing-to-replace', ''));
    picks.dialog = [Uri.file('/w/out/build/a.pptx')];
    await readBackDeck(output());
    expect(held.get('docs/flow.dgm')).toBe(DGM);
    expect(shown.some(message => message.includes('読み戻す変更がありません'))).toBe(true);
  });

  it('読んだあとで図が変わっていたら、書き戻さずに言う', async () => {
    give({ 'docs/a.md': DOC, 'docs/flow.dgm': DGM, 'themes/default/theme.css': THEME });
    written.set('out/build/a.pptx', await editedDeck('<a:t>ホーム</a:t>', '<a:t>マイページ</a:t>'));
    // 選んでいるあいだに、誰かが同じ図を書き換えた
    picks.quick = async <T>(items: readonly T[]) => {
      const document = await documentAt('docs/flow.dgm');
      document.replace({ start: document.positionAt(0), end: document.positionAt(0) } as never, '# 外から\n');
      return [...items];
    };
    await readBackDeck(output(), Uri.file('/w/out/build/a.pptx'));
    expect(held.get('docs/flow.dgm')).toBe(`# 外から\n${DGM}`);
    expect(shown.some(message => message.includes('docs/flow.dgm') && message.includes('変わっていた'))).toBe(true);
  });
});

describe('書き戻す範囲', () => {
  it('前後の同じところを除いた 1 つの範囲になる', () => {
    expect(difference('a [ホーム]\nb', 'a [マイページ]\nb')).toEqual({ start: 3, end: 6, text: 'マイページ' });
    expect(difference('same', 'same')).toEqual({ start: 4, end: 4, text: '' });
    expect(difference('abc', 'abXc')).toEqual({ start: 2, end: 2, text: 'X' });
  });
});
