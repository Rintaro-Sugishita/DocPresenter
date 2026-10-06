// The deck writer, without opening PowerPoint. What can be checked here is the
// mapping — a drawing's shapes become presets, a colour becomes six hex digits
// — and that the package that comes out is assembled in the order a reader
// expects to find it in.

import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { parseDiagram } from '@docpresenter/diagram';
import { drawingOf, escapeXml, hex, writePptx, type Deck } from '../src/index.js';

const NL = String.fromCharCode(10);
const diagram = (...lines: string[]) => parseDiagram(lines.join(NL));

describe('図形の対応', () => {
  const drawing = drawingOf(diagram(
    'free {',
    '  a [四角]', '  b [(円柱)]', '  c {判定}', '  d >注記]', '  e ([開始])',
    '  f [/入出力/]', '  g {{準備}}', '  h [/ループ開始\\]', '  i [\\ループ終了/]',
    '  a -> b', '  b -> c "ラベル"',
    '}',
    'layout {',
    '  a @ (0, 0)', '  b @ (0, 100)', '  c @ (0, 200)', '  d @ (200, 0)',
    '  e @ (200, 100)', '  f @ (200, 200)', '  g @ (400, 0)', '  h @ (400, 100)',
    '  i @ (400, 200)',
    '}',
  ));

  it('図形は DrawingML のプリセットになる', () => {
    const presets = new Map(drawing.shapes.map(shape => [shape.id, shape.preset]));
    expect(presets.get('a')).toBe('rect');
    expect(presets.get('b')).toBe('can');
    expect(presets.get('c')).toBe('diamond');
    expect(presets.get('d')).toBe('foldedCorner');
    expect(presets.get('e')).toBe('roundRect');
    expect(presets.get('f')).toBe('parallelogram');
    expect(presets.get('g')).toBe('hexagon');
    expect(presets.get('h')).toBe('trapezoid');
    expect(presets.get('i')).toBe('trapezoid');
  });

  it('接続は点の並びとして出る', () => {
    expect(drawing.connectors.length).toBe(2);
    expect(drawing.connectors[0]!.points.length).toBeGreaterThanOrEqual(2);
    expect(drawing.connectors[0]!.arrow).toBe(true);
  });

  it('ラベルは書式付きの run で運ばれる', () => {
    const bold = drawingOf(diagram('free {', '  a [**太字**]', '}', 'layout {', '  a @ (0, 0)', '}'));
    expect(bold.shapes[0]!.lines[0]![0]!.bold).toBe(true);
    expect(bold.shapes[0]!.lines[0]![0]!.text).toBe('太字');
  });

  it('著者が書いた色は運ぶ。テーマのトークンは運べない', () => {
    const styled = drawingOf(diagram(
      'free {', '  a [x]', '  b [y]', '}',
      'layout {', '  a @ (0, 0)', '  b @ (0, 100)', '}',
      'style {', '  a { fill: #e3f2fd }', '  b { fill: changed }', '}',
    ));
    const byId = new Map(styled.shapes.map(shape => [shape.id, shape]));
    expect(byId.get('a')!.fill).toBe('#e3f2fd');
    expect(byId.get('b')!.fill).toBe('#ffffff');     // 既定に落ちる
  });

  it('破線はそのまま破線になる', () => {
    const dashed = drawingOf(diagram(
      'free {', '  a [x]', '  b [y]', '  group g { a; b }', '}',
      'layout {', '  a @ (0, 0)', '  b @ (0, 100)', '  g @ (0, 0) 200x200 z:-1', '}',
      'style {', '  g { line: dashed }', '}',
    ));
    expect(dashed.shapes.find(shape => shape.id === 'g')!.dashed).toBe(true);
  });
});

describe('単独の線', () => {
  // 1 本の線は「図形」ではなく「コネクタ」として出す。そのほうが PowerPoint で
  // 端を掴んで動かせるからで、これは接続線と同じ扱いである。
  const drawn = drawingOf(diagram(
    'free {', '  rule1 --', '  arrow1 --', '  up1 --', '}',
    'layout {',
    '  rule1  @ (0, 0) 240x0',
    '  arrow1 @ (0, 40) 240x0',
    '  up1    @ (0, 80) 100x60',
    '}',
    'style {',
    '  rule1  { line: #d3d7dd, weight: 2 }',
    '  arrow1 { arrow: both }',
    '  up1    { slope: up, arrow: end }',
    '}',
  ));

  it('図形ではなくコネクタとして出る', () => {
    expect(drawn.shapes).toEqual([]);
    expect(drawn.connectors.length).toBe(3);
  });

  it('色と太さを運ぶ', () => {
    expect(drawn.connectors[0]!.line).toBe('#d3d7dd');
    expect(drawn.connectors[0]!.weight).toBe(2);
    expect(drawn.connectors[0]!.arrow).toBe(false);
  });

  it('両端の矢印は両端になる', () => {
    expect(drawn.connectors[1]!.arrow).toBe(true);
    expect(drawn.connectors[1]!.startArrow).toBe(true);
  });

  it('傾きは点の並びに出る', () => {
    const [from, to] = drawn.connectors[2]!.points;
    expect(from!.y).toBeGreaterThan(to!.y);
    expect(from!.x).toBeLessThan(to!.x);
  });
});

describe('フローの線', () => {
  const flow = drawingOf(diagram(
    'flow {', '  a [A]', '  b [B]', '  c [C]', '  a --> b', '  a --> c', '}',
  ));
  const slide = (): string => {
    const files = unzipSync(writePptx({
      title: '図', diagnostics: [],
      slides: [{ title: undefined, blocks: [flow] }],
    }));
    return strFromU8(files['ppt/slides/slide1.xml']!);
  };

  it('端は図形の上下の辺で止まり、どの辺かを覚えている', () => {
    const line = flow.connectors[0]!;
    const a = flow.shapes.find(shape => shape.id === 'a')!;
    expect(line.points[0]!.y).toBe(a.y + a.height);
    expect(line.start).toEqual({ shape: 'a', side: 'bottom' });
    expect(line.end?.side).toBe('top');
  });

  it('カギ線コネクタになり、両端が図形に付く', () => {
    const xml = slide();
    expect(xml).toContain('prst="bentConnector3"');
    expect(xml).toMatch(/<a:stCxn id="\d+" idx="2"\/><a:endCxn id="\d+" idx="0"\/>/);
    expect(xml).not.toContain('<a:custGeom>');
  });

  it('下へ向かうカギ線は 4 分の 1 回して置く', () => {
    expect(slide()).toMatch(/<a:xfrm rot="5400000"( flipV="1")?>/);
  });
});

describe('色', () => {
  it('OOXML の 6 桁に直す', () => {
    expect(hex('#1c1f24', '000000')).toBe('1C1F24');
    expect(hex('#abc', '000000')).toBe('AABBCC');
  });

  it('解決できないトークンは既定に落ちる', () => {
    expect(hex('changed', 'FFFFFF')).toBe('FFFFFF');
    expect(hex(undefined, 'FFFFFF')).toBe('FFFFFF');
  });
});

describe('XML', () => {
  it('記号を逃がす', () => {
    expect(escapeXml('a < b & "c"')).toBe('a &lt; b &amp; &quot;c&quot;');
  });
});

describe('書庫', () => {
  const deck: Deck = {
    title: '概要',
    slides: [{ title: '見出し', blocks: [{ kind: 'text', paragraphs: [[
      { text: '本文', bold: false, italic: false, code: false, colour: undefined },
    ]] }] }],
    diagnostics: [],
  };

  it('内容の型が先頭に来る', () => {
    const files = unzipSync(writePptx(deck));
    expect(Object.keys(files)[0]).toBe('[Content_Types].xml');
  });

  it('読み手が探す部品が揃っている', () => {
    const files = unzipSync(writePptx(deck));
    for (const part of [
      '_rels/.rels', 'ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml',
    ]) {
      expect(Object.keys(files)).toContain(part);
    }
  });

  it('題名と本文が入る', () => {
    const files = unzipSync(writePptx(deck));
    const slide = strFromU8(files['ppt/slides/slide1.xml']!);
    expect(slide).toContain('見出し');
    expect(slide).toContain('本文');
  });
});
