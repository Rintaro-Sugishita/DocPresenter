// Reading a deck back into the drawings it came from, after an edit made the
// way PowerPoint would make it: in the slide's XML.

import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { build, writeBack, type Workspace } from '../src/index.js';

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => Object.keys(files),
  read: path => files[path],
  dataUrl: () => undefined,
});

/** The deck with `from` replaced by `to` in the slide the drawing is on. */
function edited(pptx: Uint8Array, drawing: string, from: string, to: string): Uint8Array {
  const files = unzipSync(pptx);
  const slide = Object.keys(files).find(name =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name) && strFromU8(files[name]!).includes(drawing));
  expect(slide).toBeDefined();
  const xml = strFromU8(files[slide!]!);
  expect(xml).toContain(from);
  files[slide!] = strToU8(xml.replace(from, to));
  return zipSync(files);
}

/** The deck with one shape moved right by `dx` EMU, as PowerPoint writes a drag. */
function moved(pptx: Uint8Array, drawing: string, id: string, dx: number): Uint8Array {
  const files = unzipSync(pptx);
  const slide = Object.keys(files).find(name =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name) && strFromU8(files[name]!).includes(drawing))!;
  const xml = strFromU8(files[slide]!).replace(/<p:sp>[\s\S]*?<\/p:sp>/g, shape =>
    shape.includes(`name="${id}"`)
      ? shape.replace(/<a:off x="(\d+)"/, (_, x: string) => `<a:off x="${Number(x) + dx}"`)
      : shape);
  files[slide] = strToU8(xml);
  return zipSync(files);
}

describe('読み戻し', () => {
  // 文字を短くすると自動レイアウトでは隣の図形も動く。スライドは直す前の図から
  // 描かれたものなので、比べる相手も直す前の配置でなければならない。
  it('ラベルを短くしても、動かしていない図形はピンにならない', async () => {
    const files = workspace({
      'docs/a.md': '---\ntitle: T\noutput: [pptx]\n---\n\n# A\n\n@import "flow.dgm" {#fig-flow}\n',
      'docs/flow.dgm': 'flow {\n  a [開始]\n  b [アカウントロック画面へ移動する]\n  c [終了]\n  a --> b\n  b --> c\n}\n',
      'themes/default/theme.css': 'body { color: #000 }\n',
    });
    const result = await build(files);
    const pptx = result.artifacts.find(a => a.format === 'pptx')!.bytes!;
    const deck = moved(edited(pptx, 'flow.dgm', '<a:t>アカウントロック画面へ移動する</a:t>', '<a:t>ロック画面</a:t>'),
      'flow.dgm', 'c', 914400);
    const back = writeBack(deck, files).files.find(file => file.path === 'docs/flow.dgm')!;
    expect(back.changes).toEqual(['b の文字を「ロック画面」に', 'c の位置を更新']);
    expect(back.text).toMatch(/^\s*c\s*@/m);
    expect(back.text).not.toMatch(/^\s*[ab]\s*@/m);
  });


  it('同じスライドの表は、図の図形の文字にも大きさにも混ざらない', async () => {
    const files = workspace({
      'docs/a.md': '---\ntitle: T\noutput: [pptx]\n---\n\n# A\n\n'
        + '@import "login.dgm" {#fig-login}\n\n@import "terms.table"\n',
      'docs/login.dgm': 'flow {\n  a [ログイン]\n  b [ホーム]\n  a --> b\n}\n\n'
        + 'layout {\n  a @ (10, 20)\n  b @ (10, 120)\n}\n',
      'docs/terms.table': '| 用語 | 説明 |\n| ---- | ---- |\n'
        + '| トークン | 認可に用いる |\n| 会員 | 登録済みの利用者 |\n',
      'themes/default/theme.css': 'body { color: #000 }\n',
    });
    const result = await build(files);
    const pptx = result.artifacts.find(a => a.format === 'pptx')!.bytes!;

    const back = writeBack(edited(pptx, 'login.dgm', '<a:t>ホーム</a:t>', '<a:t>トップ</a:t>'), files);
    const login = back.files.find(file => file.path === 'docs/login.dgm')!;
    expect(login.changes).toEqual(['b の文字を「トップ」に']);
    expect(login.text).toContain('b [トップ]');
    expect(login.text).not.toContain('150x56');
  });
});
