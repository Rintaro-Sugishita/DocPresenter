// A drawing checked out with CRLF line endings (core.autocrlf on Windows).
//
// The product measures its ranges on the LF text (design/review-model.md §3),
// but a CRLF text handed to the parser directly must still be read right: every
// range points at the bytes of the text it was given, and every edit leaves a
// CRLF file CRLF.

import { describe, expect, it } from 'vitest';
import { applyEdit, byteLength, sliceBytes, type Edit } from '@docpresenter/base';
import {
  addNode, bendEdge, connectNodes, disconnectNodes, parseDiagram, pinNode, removeNode, setItems,
  setNodePart, setNodeShape, setNodeStyle, setNodeText, unpinNode,
} from '../src/index.js';
import type { DiagramFile } from '../src/model.js';

const LF = [
  '# ログイン画面',
  'use "default"',
  '',
  'free {',
  '  frame [ ]',
  '  title "サービスにログイン"',
  '  nav   tree: {',
  '    - 全社',
  '      - 営業 *',
  '  }',
  '  ok    ([送信])',
  '',
  '  title --> ok',
  '}',
  '',
  'layout {',
  '  frame @ ( 40,  20) 380x392  z:-1',
  '  title @ ( 70,  50) 320x24',
  '  nav   @ ( 70, 100) 200x80',
  '  ok    @ ( 70, 300)',
  '}',
  '',
  'style {',
  '  title { fill: #eef3f9 }',
  '}',
  '',
].join('\n');
const CRLF = LF.replace(/\n/g, '\r\n');
const crlf = (text: string): string => text.replace(/\r?\n/g, '\r\n');

describe('CRLF の図を読む', () => {
  it('範囲は、渡された文のそのバイトを指す', () => {
    const file = parseDiagram(CRLF);
    for (const [id, pin] of file.layout) {
      const text = sliceBytes(CRLF, pin.span.start, pin.span.end);
      expect(text.startsWith(id)).toBe(true);
      expect(text).not.toMatch(/[\r\n]/);
    }
    for (const node of file.nodes) {
      expect(sliceBytes(CRLF, node.span.start, node.span.end).startsWith(node.id)).toBe(true);
    }
  });

  it('後ろの行ほどずれる、ということが無い', () => {
    const file = parseDiagram(CRLF);
    const ok = file.layout.get('ok')!;
    expect(sliceBytes(CRLF, ok.span.start, ok.span.end)).toBe('ok    @ ( 70, 300)');
  });

  it('読んだ中身は、LF の図と同じ', () => {
    const a = parseDiagram(LF);
    const b = parseDiagram(CRLF);
    expect(b.nodes.map(n => [n.id, n.text, n.shape])).toEqual(a.nodes.map(n => [n.id, n.text, n.shape]));
    expect(b.nodes.find(n => n.id === 'nav')!.items).toEqual(a.nodes.find(n => n.id === 'nav')!.items);
    expect([...b.style]).toEqual([...a.style]);
    expect(b.comments).toEqual(a.comments);
  });

  it('ブロックの終わりは、閉じ括弧の後ろ（CR の手前）', () => {
    const file = parseDiagram(CRLF);
    const block = file.layoutBlock!;
    expect(sliceBytes(CRLF, block.span.end - 1, block.span.end)).toBe('}');
    expect(byteLength(CRLF.slice(0, CRLF.indexOf('layout {')))).toBe(block.span.start);
  });
});

/**
 * Every edit, made on the CRLF drawing, comes out as the same edit made on the
 * LF one — with CRLF line endings, and nothing else different.
 */
const EDITS: Record<string, (file: DiagramFile, source: string) => Edit> = {
  '動かす': (f, s) => pinNode(f, s, 'ok', { x: 72, y: 300 }),
  '図形を足す': (f, s) => addNode(f, s, { shape: 'rect', text: '新しい箱' }),
  '図形を消す': (f, s) => removeNode(f, s, 'ok'),
  '文字を変える': (f, s) => setNodeText(f, 'title', 'サインイン', s),
  '種類を変える': (f) => setNodeShape(f, 'ok', 'rect'),
  '部品にする': (f, s) => setNodePart(f, s, 'title', 'label'),
  '行を持つ部品を変える': (f, s) => setNodePart(f, s, 'nav', 'list'),
  '見た目を変える': (f, s) => setNodeStyle(f, s, 'ok', { fill: '#fff0f0' }),
  '繋ぐ': (f, s) => connectNodes(f, s, 'frame', 'ok'),
  '繋ぎを切る': (f, s) => disconnectNodes(f, s, 'title', 'ok'),
  '曲げる': (f, s) => bendEdge(f, s, 'title', 'ok', [{ x: 0, y: 200 }]),
  '一覧の行を変える': (f, s) => setItems(f, s, 'nav', [
    ...f.nodes.find(n => n.id === 'nav')!.items,
    { text: '管理', depth: 1, closed: false, picked: false },
  ]),
  '一覧を空にする': (f, s) => setItems(f, s, 'nav', []),
};

/** Made on the CRLF drawing, the same as on the LF one, and still CRLF. */
const same = (lf: string, make: (file: DiagramFile, source: string) => Edit): void => {
  const expected = crlf(applyEdit(lf, make(parseDiagram(lf), lf)));
  const source = crlf(lf);
  const written = applyEdit(source, make(parseDiagram(source), source));
  expect(written).toBe(expected);
  expect(written).not.toMatch(/(?<!\r)\n/);
};

describe('CRLF の図を編集する', () => {
  for (const [name, make] of Object.entries(EDITS)) {
    it(`${name}: LF の図で同じことをしたのと同じになり、CRLF のまま`, () => same(LF, make));
  }

  // 行を消す編集は、改行ごと消す。CRLF の CR だけが残ると、空行が 1 つ増える。
  it('ピンを外す: 行ごと消え、CR が残らない', () => {
    const flow = ['flow {', '  a [あ]', '  b [い]', '  a --> b', '}', '', 'layout {',
      '  a @ (10, 20)', '  b @ (10, 90)', '}', ''].join('\n');
    same(flow, (f, s) => unpinNode(f, s, 'a'));
  });
});
