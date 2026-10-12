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

describe('線のラベル', () => {
  const FLOW = 'flow {\n  a [受付]\n  b [確定]\n  c [取消]\n  a --> b "在庫引き当て"\n  a --> c "顧客が **取消**"\n  b --> c\n}\n';
  const files = workspace({
    'docs/a.md': '---\ntitle: T\noutput: [pptx]\n---\n\n# A\n\n@import "flow.dgm" {#fig-flow}\n',
    'docs/flow.dgm': FLOW,
    'themes/default/theme.css': 'body { color: #000 }\n',
  });
  const deck = async (): Promise<Uint8Array> =>
    (await build(files)).artifacts.find(a => a.format === 'pptx')!.bytes!;
  const slideOf = (pptx: Uint8Array): string => {
    const parts = unzipSync(pptx);
    return strFromU8(parts[Object.keys(parts).find(name =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name) && strFromU8(parts[name]!).includes('flow.dgm'))!]!);
  };

  it('ラベルのある線ごとに、線の名前の付いた文字の箱がスライドに載る', async () => {
    const slide = slideOf(await deck());
    const boxes = [...slide.matchAll(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?name="edge ([^"]*)"[\s\S]*?<\/p:sp>/g)];
    expect(boxes.map(found => found[1])).toEqual(['a-&gt;b', 'a-&gt;c']);
    const text = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(found => found[1]).join('');
    expect(text(boxes[0]![0])).toBe('在庫引き当て');
    // The inline formatting of a label reaches the slide as it does the screen.
    expect(text(boxes[1]![0])).toBe('顧客が 取消');
    expect(boxes[1]![0]).toMatch(/<a:rPr[^>]*\bb="1"[^>]*>(?:(?!<\/a:r>)[\s\S])*取消/);
    // Laid over the lines and the shapes, as on screen: after every connector.
    expect(slide.lastIndexOf('<p:cxnSp>')).toBeLessThan(slide.indexOf('name="edge '));
  });

  it('触っていないデッキを読み戻すと、ラベルは図形として数えられず、何も変わらない', async () => {
    const back = writeBack(await deck(), files);
    expect(back.files.find(file => file.path === 'docs/flow.dgm')!.text).toBe(FLOW);
    expect(back.diagnostics).toEqual([]);
  });

  it('PowerPoint でラベルを直すと、黙って捨てずに読み戻せないと言う', async () => {
    const changed = edited(await deck(), 'flow.dgm', '<a:t>在庫引き当て</a:t>', '<a:t>引き当て済み</a:t>');
    const back = writeBack(changed, files);
    expect(back.files.find(file => file.path === 'docs/flow.dgm')!.text).toBe(FLOW);
    expect(back.diagnostics.map(one => one.message)).toEqual([
      'a → b の線のラベルが「在庫引き当て」から「引き当て済み」に変わっているが、線のラベルはまだ読み戻せない（図で直すこと）',
    ]);
  });
});

describe('表の書き換え', () => {
  const files = workspace({
    'docs/a.md': '---\ntitle: T\noutput: [pptx]\n---\n\n# A\n\n@import "terms.table" {#tbl-terms}\n',
    'docs/terms.table': '| 用語 | 説明 |\n| ---- | ---- |\n| トークン | 認可に用いる |\n',
    'themes/default/theme.css': 'body { color: #000 }\n',
  });
  const deck = async (): Promise<Uint8Array> =>
    (await build(files)).artifacts.find(a => a.format === 'pptx')!.bytes!;

  it('触っていない表は何も言わない', async () => {
    expect(writeBack(await deck(), files).diagnostics).toEqual([]);
  });

  it('PowerPoint で表を直すと、読み戻せないことをその表のファイルの名前で言う', async () => {
    const pptx = await deck();
    const parts = unzipSync(pptx);
    const slide = Object.keys(parts).find(name =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name) && strFromU8(parts[name]!).includes('dp:table='))!;
    parts[slide] = strToU8(strFromU8(parts[slide]!).replace('<a:t>認可に用いる</a:t>', '<a:t>認可に使う</a:t>'));
    const back = writeBack(zipSync(parts), files);
    expect(back.diagnostics).toEqual([expect.objectContaining({
      severity: 'warning', path: 'docs/terms.table',
      message: '1 枚目の表（docs/terms.table）が PowerPoint で書き換えられているが、表は読み戻せない（docs/terms.table を直すこと）',
    })]);
    expect(back.files).toEqual([]);
  });
});
