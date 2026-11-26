import { describe, expect, it } from 'vitest';
import { applyEdit, byteLength } from '@docpresenter/base';
import { parseDiagram } from '../src/parse.js';
import { moveToOrigin, renameNode, setEdgeLabel } from '../src/edits.js';
import { pickAt, rememberSource } from '../src/source-pick.js';
import { isLeftOut, itemColumns, itemShapes, newItemTable, screenItems, useItemSettings } from '../src/items.js';
import { layOutDiagram } from '../src/layout.js';
import { addField } from '../src/fields.js';
import { withParts } from '../src/parts.js';
import { DEFAULT_PARTS } from '../src/default-parts.js';
import { isHidden, setVisible } from '../src/states.js';
import { drawnRoutes, renderDiagram } from '../src/draw/render.js';

const FLOW = [
  'flow {',
  '  a [開始 a]',
  '  b [b]',
  '  group g "グループ" {',
  '    a',
  '    b',
  '  }',
  '  a --> b "はい"',
  '  b --> a ~',
  '}',
  'layout {',
  '  a @ (10, 20)',
  '  b @ (40, 90) 120x40',
  '  a -> b @ (30, 50)',
  '}',
  'style {',
  '  a { fill: #ffffff }',
  '}',
  '',
].join('\n');

describe('線の文字', () => {
  it('書き換え、消し、無い線には足す', () => {
    const file = parseDiagram(FLOW);
    const changed = applyEdit(FLOW, setEdgeLabel(file, FLOW, 'a', 'b', 'いいえ'));
    expect(changed).toContain('a --> b "いいえ"');
    const cleared = applyEdit(FLOW, setEdgeLabel(file, FLOW, 'a', 'b', ''));
    expect(cleared).toContain('  a --> b\n');
    const added = applyEdit(FLOW, setEdgeLabel(file, FLOW, 'b', 'a', '戻る'));
    // 末尾の ~ は残る
    expect(added).toContain('b --> a "戻る" ~');
    expect(parseDiagram(added).edges.find(e => e.from === 'b')?.loose).toBe(true);
  });
});

describe('名前を変える', () => {
  it('図形の行・線・グループ・配置・折れ点・見た目がそろって変わり、文字は変わらない', () => {
    const file = parseDiagram(FLOW);
    const text = applyEdit(FLOW, renameNode(file, FLOW, 'a', 'start'));
    expect(text).toContain('  start [開始 a]');
    expect(text).toContain('    start\n    b\n');
    expect(text).toContain('start --> b "はい"');
    expect(text).toContain('b --> start ~');
    expect(text).toContain('start @ (10, 20)');
    expect(text).toContain('start -> b @ (30, 50)');
    expect(text).toContain('start { fill: #ffffff }');
    const again = parseDiagram(text);
    expect(again.nodes.map(n => n.id)).toEqual(expect.arrayContaining(['start', 'b', 'g']));
  });

  it('使えない名前や、既にある名前は断る', () => {
    const file = parseDiagram(FLOW);
    expect(() => renameNode(file, FLOW, 'a', 'b')).toThrow();
    expect(() => renameNode(file, FLOW, 'a', 'x-y')).toThrow();
  });
});

describe('左上を (0, 0) に寄せる', () => {
  it('ピンと折れ点が同じだけ動く', () => {
    const text = applyEdit(FLOW, moveToOrigin(parseDiagram(FLOW), FLOW));
    expect(text).toMatch(/a @ \( *0, +0\)/);
    expect(text).toContain('b @ (30, 70) 120x40');
    expect(text).toContain('a -> b @ (20, 30)');
    expect(() => moveToOrigin(parseDiagram(text), text)).toThrow();
  });
});

describe('カーソルの行が指すもの', () => {
  const file = rememberSource(parseDiagram(FLOW), FLOW);
  const at = (needle: string): number => byteLength(FLOW.slice(0, FLOW.indexOf(needle) + 1));
  it('図形・線・配置・グループの中の名前', () => {
    expect(pickAt(file, at('b [b]'))).toEqual({ kind: 'shape', id: 'b' });
    expect(pickAt(file, at('a --> b'))).toEqual({ kind: 'edge', name: 'a->b' });
    expect(pickAt(file, at('b @ (40'))).toEqual({ kind: 'shape', id: 'b' });
    expect(pickAt(file, at('a -> b @'))).toEqual({ kind: 'edge', name: 'a->b' });
    // グループの中に書かれた名前は、そのメンバー
    expect(pickAt(file, at('b\n  }'))).toEqual({ kind: 'shape', id: 'b' });
    expect(pickAt(file, at('group g'))).toEqual({ kind: 'shape', id: 'g' });
  });
});

describe('stack の中で大きさを書いた部品', () => {
  it('幅が自分の大きさになり、ほかは stack の幅いっぱい', () => {
    const text = [
      'free {', '  s ""', '  a [A]', '  b [B]', '}',
      'layout {', '  s @ (0, 0) 300x200', '  stack s (down; gap: 0; pad: 0) {', '    a', '    b', '  }', '  b 120x30', '}', '',
    ].join('\n');
    const laid = layOutDiagram(parseDiagram(text));
    expect(laid.boxes.get('a')?.width).toBe(300);
    expect(laid.boxes.get('b')?.width).toBe(120);
  });
});

describe('格子に入力欄を足す', () => {
  it('選んだものの後ろの空きセルに入り、穴の空いた行を作らない', () => {
    const src = ['use "default"', '', 'free {', '  frame [ ]', '  a textbox:', '  b textbox:', '  c textbox:', '}', 'layout {',
      '  frame @ (0, 0) 400x300', '  grid frame (cols: 1fr, 1fr) {', '    a ; b', '    c ; .', '  }', '}', ''].join('\n');
    const file = withParts(parseDiagram(src), path => (path === 'default' ? DEFAULT_PARTS : undefined));
    const out = applyEdit(src, addField(file, src, { part: 'textbox', label: 'L', near: 'b', at: { x: 0, y: 0 } }).edit);
    expect(out).toContain('c ; textbox1Field');
    expect(out).not.toContain('. ; textbox1Field');
  });
});

describe('ラベルも項目になる', () => {
  const src = ['use "default"', '', 'free {', '  msg label:"お知らせ"', '  form ""', '  nameLabel label:"氏名"',
    '  nameBox textbox:', '  head title:"見出し"', '  skip label:"外す"', '}', 'layout {', '  msg @ (0, 0)',
    '  form @ (0, 40)', '  stack form (down) {', '    nameLabel', '    nameBox', '  }', '  head @ (0, 200)',
    '  skip @ (0, 240)', '}', 'style {', '  skip { item: no }', '}', ''].join(String.fromCharCode(10));
  it('名前になっていないラベルは「表示」の項目、名前のラベル・見出し・item: no は項目でない', () => {
    const file = withParts(parseDiagram(src), path => (path === 'default' ? DEFAULT_PARTS : undefined));
    const items = itemShapes(file);
    expect(items.get('msg')).toBe('表示');
    expect(items.get('nameBox')).toBe('入力');
    expect(items.has('nameLabel')).toBe(false);
    expect(items.has('head')).toBe(false);
    expect(items.has('skip')).toBe(false);
    expect(isLeftOut(file, 'skip')).toBe(true);
  });
});

describe('非表示（visible: false）', () => {
  const src = [
    'free {', '  s ""', '  a [A]', '  gap [ ]', '  b [B]', '  c [C]', '}',
    'layout {', '  s @ (0, 0) 200x200', '  stack s (down; gap: 0; pad: 0) {', '    a', '    gap', '    b', '  }', '  c @ (300, 0)', '}',
    '  ', '',
  ].join('\n').replace('  \n', '');
  it('場所は空けたまま描かず、線も描かない。エディタは薄く描く', () => {
    const text = applyEdit(src, setVisible(src, 'gap', false));
    expect(text).toContain('gap { visible: false }');
    const withLine = text.replace('  c [C]', '  c [C]\n  gap --> c');
    const file = parseDiagram(withLine);
    const laid = layOutDiagram(file);
    // b は gap の下のまま
    expect(laid.boxes.get('b')!.y).toBeGreaterThan(laid.boxes.get('gap')!.y);
    const out = renderDiagram(file);
    expect(out).not.toContain('data-node="gap"');
    expect(out).not.toContain('data-edge="gap->c"');
    expect(renderDiagram(file, undefined, undefined, 'ja', true)).toContain('class="dp-unseen dp-node');
    expect(isHidden(file.style.get('gap'))).toBe(true);
  });
});

describe('項目一覧の判定', () => {
  const read = (path: string): string | undefined => (path === 'default' ? DEFAULT_PARTS : undefined);
  const screen = (body: string[], layout: string[], style: string[] = []): ReturnType<typeof parseDiagram> =>
    withParts(parseDiagram(['use "default"', '', 'free {', ...body.map(one => `  ${one}`), '}', 'layout {',
      ...layout.map(one => `  ${one}`), '}', 'style {', ...style.map(one => `  ${one}`), '}', ''].join('\n')), read);

  it('ラベル＋ラベルの組は、後ろが項目で前がその名前。続けて並んでも 2 組になる', () => {
    const file = screen(
      ['s ""', 'a label:"氏名"', 'b label:"山田 太郎"', 'c label:"住所"', 'd label:"東京都"'],
      ['s @ (0, 0)', 'stack s (down) {', '  a', '  b', '  c', '  d', '}']);
    const items = itemShapes(file);
    expect([...items.keys()].sort()).toEqual(['b', 'd']);
    const named = screenItems(file);
    expect(named.find(one => one.id === 'b')?.label).toBe('a');
    expect(named.find(one => one.id === 'd')?.label).toBe('c');
  });

  it('使えない入力欄は「表示」の項目', () => {
    const file = screen(['x textbox:', 'y textbox:'], ['x @ (0, 0)', 'y @ (0, 50)'], ['x { enabled: false }']);
    expect(itemShapes(file).get('x')).toBe('表示');
    expect(itemShapes(file).get('y')).toBe('入力');
  });

  it('grid では、上のセルのラベルも項目の名前になる', () => {
    const file = screen(['g ""', 'l1 label:"氏名"', 'l2 label:"年齢"', 'v1 textbox:', 'v2 textbox:'],
      ['g @ (0, 0) 400x100', 'grid g (cols: 1fr, 1fr) {', '  l1 ; l2', '  v1 ; v2', '}']);
    expect(screenItems(file).find(one => one.id === 'v2')?.label).toBe('l2');
    expect(itemShapes(file).has('l1')).toBe(false);
  });

  it('リポジトリの設定で、新しい項目一覧の列と見出しを決められ、その見出しで読める', () => {
    const file = screen(['x textbox:'], ['x @ (0, 0)']);
    useItemSettings({ items: { columns: [{ 'No': 'number' }, { 'ID': 'id' }, { '論理名': 'name' }, '桁数'] } });
    try {
      const table = newItemTable(file, 'ja');
      expect(table).toMatch(/\| No +\| ID +\| 論理名 +\| 桁数 +\|/);
      expect(itemColumns(['No', 'ID', '論理名', '桁数'])).toEqual({ number: 0, id: 1, name: 2 });
    } finally {
      useItemSettings(undefined);
    }
    expect(newItemTable(file, 'ja')).toContain('| 分類');
  });

  it('grid の中でも、大きさを書いた部品はセルより狭くできる', () => {
    const file = screen(['g ""', 'v1 textbox:', 'v2 textbox:'],
      ['g @ (0, 0) 400x100', 'grid g (cols: 1fr, 1fr; gap: 0; pad: 0) {', '  v1 ; v2', '}', 'v1 80x34']);
    const laid = layOutDiagram(file);
    expect(laid.boxes.get('v1')!.width).toBe(80);
    expect(laid.boxes.get('v2')!.width).toBe(200);
  });
});

describe('描かれた線', () => {
  it('絵の部品どうしの線は、名前を含む箱でなく絵の中心どうしを結ぶ', () => {
    const src = ['free {', '  a "PC"', '  b "ノート PC"', '  b --> a', '}', 'layout {', '  a @ (40, 124)', '  b @ (236, 212)', '}',
      'style {', '  a { icon: net/pc }', '  b { icon: net/laptop }', '}', ''].join('\n');
    const file = parseDiagram(src);
    const laid = layOutDiagram(file);
    const [route] = drawnRoutes(file, laid);
    const box = laid.boxes.get('b')!;
    // 箱の中心より上（名前の分だけ）を通る
    expect(route!.points[0]!.y).toBeLessThan(box.y + box.height / 2);
    expect(laid.routes[0]!.points[0]!.y).toBe(box.y + box.height / 2);
  });
});
