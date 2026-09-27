import { describe, expect, it } from 'vitest';
import { parseDiagram } from '@docpresenter/core';
import {
  addNode, applyEdit, canUnpin, connectNodes, DiagramEditError, disconnectNodes, groupMembers,
  groupNodes, moveCallout, pinNode, pinNodes, reconnect, removeNode, removeNodes, setNodeShape,
  setNodeText, unpinNode,
} from '../src/index.js';

const FLOW = [
  '# 流れ',
  '',
  'flow {',
  '  start ([開始])',
  '  next  [次の画面]',
  '  done  [完了]',
  '',
  '  start --> next',
  '  next  --> done',
  '}',
  '',
  'layout {',
  '  done @ (320, 640)',
  '}',
  '',
  'style {',
  '  theme: default',
  '}',
].join('\n');

const SCREEN = [
  'free {',
  '  frame [ ]',
  '  title "見出し"',
  '}',
  '',
  'layout {',
  '  frame @ ( 40,  20) 380x330  z:-1',
  '  title @ ( 70,  50) 320x24',
  '}',
].join('\n');

const OVERLAY = [
  'overlay "../assets/login.png" {',
  '  ① @ (168, 126) -> (188, 132)  "ログイン ID"',
  '  ② @ (168, 186) -> (188, 192)  "パスワード"',
  '}',
].join('\n');

const run = (source: string, make: (f: ReturnType<typeof parseDiagram>) => ReturnType<typeof pinNode>) =>
  applyEdit(source, make(parseDiagram(source)));

const layout = (source: string) => {
  const from = source.indexOf('layout {');
  return source.slice(from, source.indexOf('}', from) + 1).split('\n');
};

describe('図形のピン留め', () => {
  it('既にある行だけが書き換わる', () => {
    const written = run(FLOW, f => pinNode(f, FLOW, 'done', { x: 300, y: 620 }));
    expect(layout(written)).toEqual(['layout {', '  done @ (300, 620)', '}']);
    expect(written.replace(/@ \(300, 620\)/, '@ (320, 640)')).toBe(FLOW);
  });

  it('自動配置の図形には行が 1 行足される', () => {
    const written = run(FLOW, f => pinNode(f, FLOW, 'next', { x: 16, y: 80 }));
    expect(layout(written)).toEqual(['layout {', '  done @ (320, 640)', '  next @ (16, 80)', '}']);
  });

  it('layout セクションが無ければ作る', () => {
    const source = 'flow {\n  a [A]\n}\n';
    const written = applyEdit(source, pinNode(parseDiagram(source), source, 'a', { x: 8, y: 8 }));
    expect(written).toBe('flow {\n  a [A]\n}\n\nlayout {\n  a @ (8, 8)\n}\n');
    expect(parseDiagram(written).layout.get('a')).toMatchObject({ x: 8, y: 8 });
  });

  it('手で揃えた桁が保たれる', () => {
    const written = run(SCREEN, f => pinNode(f, SCREEN, 'title', { x: 100, y: 8 }));
    expect(layout(written)).toContain('  title @ (100,   8) 320x24');
  });

  it('動かしても大きさと奥行きは残る', () => {
    const written = run(SCREEN, f => pinNode(f, SCREEN, 'frame', { x: 44, y: 24 }));
    expect(layout(written)).toContain('  frame @ ( 44,  24) 380x330  z:-1');
  });

  it('大きさを変える', () => {
    const written = run(SCREEN, f => pinNode(f, SCREEN, 'title', { x: 70, y: 50, width: 200, height: 30 }));
    expect(layout(written)).toContain('  title @ ( 70,  50) 200x30');
  });

  it('無い図形は止める', () => {
    expect(() => pinNode(parseDiagram(FLOW), FLOW, 'nope', { x: 0, y: 0 }))
      .toThrow(DiagramEditError);
  });
});

describe('ピンの解除', () => {
  it('行ごと消え、残りの行は動かない', () => {
    const two = FLOW.replace('  done @ (320, 640)', '  next @ ( 80,  40)\n  done @ (320, 640)');
    const written = run(two, f => unpinNode(f, two, 'next'));
    expect(layout(written)).toEqual(['layout {', '  done @ (320, 640)', '}']);
  });

  it('最後の 1 行を消しても空の layout が残る', () => {
    const written = run(FLOW, f => unpinNode(f, FLOW, 'done'));
    expect(layout(written)).toEqual(['layout {', '}']);
    expect(parseDiagram(written).layout.size).toBe(0);
  });

  it('留めていない図形は解除できない', () => {
    expect(() => unpinNode(parseDiagram(FLOW), FLOW, 'next')).toThrow(DiagramEditError);
  });

  it('自由配置の図では外せない（外すと置き場所が無くなる）', () => {
    const file = parseDiagram(SCREEN);
    expect(canUnpin(file, 'title')).toBe(false);
    expect(() => unpinNode(file, SCREEN, 'title')).toThrow(/自由配置/);
  });

  it('グループはどの図でも外せる（中身から決まるので）', () => {
    const source = [
      'free {', '  a [A]', '  group g "G" { a }', '}', '',
      'layout {', '  a @ (10, 10)', '  g @ (0, 0) 100x100  z:-1', '}',
    ].join('\n');
    const file = parseDiagram(source);
    expect(canUnpin(file, 'g')).toBe(true);
    expect(applyEdit(source, unpinNode(file, source, 'g'))).not.toContain('g @ (0, 0)');
  });
});

describe('注釈の移動', () => {
  it('座標だけが変わり、文言はそのまま', () => {
    const written = applyEdit(
      OVERLAY,
      moveCallout(parseDiagram(OVERLAY), OVERLAY, '②', { x: 170, y: 200, targetX: 190, targetY: 206 }),
    );
    expect(written.split('\n')[2]).toBe('  ② @ (170, 200) -> (190, 206)  "パスワード"');
    expect(written.split('\n')[1]).toBe('  ① @ (168, 126) -> (188, 132)  "ログイン ID"');
  });
});

describe('図形の追加と削除', () => {
  const GROUPED = [
    'free {',
    '  a [A]',
    '  b [B]',
    '  group g "まとまり" { a; b }',
    '',
    '  a --> b',
    '}',
    '',
    'layout {',
    '  a @ (10, 10)',
    '  b @ (10, 90)',
    '}',
  ].join('\n');

  const body = (source: string) => {
    const from = source.indexOf('free {');
    return source.slice(from, source.indexOf('\n}', from)).split('\n');
  };

  it('自由配置では図形の行とピンの行が 1 回で入る', () => {
    const written = run(GROUPED, f => addNode(f, GROUPED, {
      shape: 'round-rect', text: '新しい図形', at: { x: 40, y: 200 },
    }));
    expect(body(written)).toContain('  box1 (新しい図形)');
    expect(layout(written)).toContain('  box1 @ (40, 200)');
    const file = parseDiagram(written);
    expect(file.nodes.map(n => n.id)).toEqual(['a', 'b', 'g', 'box1']);
  });

  it('自動配置の図ではピンを書かない（エンジンが置く）', () => {
    const written = run(FLOW, f => addNode(f, FLOW, { shape: 'rect', text: '次' }));
    expect(layout(written)).toEqual(['layout {', '  done @ (320, 640)', '}']);
    expect(parseDiagram(written).nodes.map(n => n.id)).toContain('box1');
  });

  it('名前は使われていないものを選ぶ', () => {
    const once = run(FLOW, f => addNode(f, FLOW, { shape: 'rect', text: '一' }));
    const twice = applyEdit(once, addNode(parseDiagram(once), once, { shape: 'rect', text: '二' }));
    expect(parseDiagram(twice).nodes.map(n => n.id)).toEqual(
      ['start', 'next', 'done', 'box1', 'box2']);
  });

  it('削除は図形・線・ピン・グループの参照をまとめて消す', () => {
    const written = run(GROUPED, f => removeNode(f, GROUPED, 'b'));
    const file = parseDiagram(written);
    expect(file.nodes.map(n => n.id)).toEqual(['a', 'g']);
    expect(file.edges).toHaveLength(0);
    expect(file.layout.has('b')).toBe(false);
    expect(file.nodes.find(n => n.id === 'g')!.children).toEqual(['a']);
    // 触っていない行はそのまま
    expect(written).toContain('  a [A]');
    expect(layout(written)).toContain('  a @ (10, 10)');
  });

  it('文字と種類は同じ行の書き換え', () => {
    const named = run(GROUPED, f => setNodeText(f, 'a', 'あたらしい名前'));
    expect(body(named)).toContain('  a [あたらしい名前]');
    const shaped = run(GROUPED, f => setNodeShape(f, 'a', 'diamond'));
    expect(body(shaped)).toContain('  a {A}');
  });

  it('種類を変えてもスタイル指定は残る', () => {
    const source = 'flow {\n  a [A]:::pending\n}';
    const written = applyEdit(source, setNodeShape(parseDiagram(source), 'a', 'ellipse'));
    expect(written).toContain('a ((A)):::pending');
  });

  it('グループの名前を変えてもグループのまま', () => {
    const written = run(GROUPED, f => setNodeText(f, 'g', 'ひとまとまり'));
    const group = parseDiagram(written).nodes.find(n => n.id === 'g')!;
    expect(group.shape).toBe('group');
    expect(group.text).toBe('ひとまとまり');
    expect(group.children).toEqual(['a', 'b']);
  });

  it('線を引く・消す', () => {
    const drawn = run(FLOW, f => connectNodes(f, FLOW, 'start', 'done'));
    expect(parseDiagram(drawn).edges.map(e => `${e.from}->${e.to}`)).toContain('start->done');
    const gone = applyEdit(drawn, disconnectNodes(parseDiagram(drawn), drawn, 'start', 'done'));
    expect(parseDiagram(gone).edges.map(e => `${e.from}->${e.to}`)).not.toContain('start->done');
    expect(gone).toBe(FLOW);
  });

  it('線のつなぎ替えは同じ行の書き換え', () => {
    const written = run(FLOW, f => reconnect(f, FLOW, { from: 'start', to: 'next' }, { to: 'done' }));
    expect(written).toContain('  start --> done');
    expect(parseDiagram(written).edges.map(e => `${e.from}->${e.to}`))
      .toEqual(['start->done', 'next->done']);
  });

  it('つなぎ替えてもラベルと線種は残る', () => {
    const source = 'flow {\n  a [A]\n  b [B]\n  c [C]\n  a -.-> b  "かもしれない"\n}';
    const written = applyEdit(source,
      reconnect(parseDiagram(source), source, { from: 'a', to: 'b' }, { to: 'c' }));
    expect(written).toContain('  a -.-> c  "かもしれない"');
    const edge = parseDiagram(written).edges[0]!;
    expect(edge.line).toBe('dashed');
    expect(edge.label).toBe('かもしれない');
  });

  it('つなぎ替え先が既に繋がっていれば断る', () => {
    expect(() => reconnect(parseDiagram(FLOW), FLOW, { from: 'start', to: 'next' }, { from: 'next' }))
      .toThrow(DiagramEditError);
  });

  it('同じ線を二度は引かない', () => {
    expect(() => connectNodes(parseDiagram(FLOW), FLOW, 'start', 'next')).toThrow(DiagramEditError);
    expect(() => connectNodes(parseDiagram(FLOW), FLOW, 'start', 'start')).toThrow(DiagramEditError);
  });
});

describe('まとめて動かす・まとめる', () => {
  const GROUPED = [
    'free {',
    '  a [A]',
    '  b [B]',
    '  c [C]',
    '  group g "まとまり" { a; b }',
    '}',
    '',
    'layout {',
    '  a @ ( 10,  10)',
    '  b @ ( 10,  90)',
    '  g @ (  0,   0) 200x200  z:-1',
    '}',
  ].join('\n');

  it('グループの中身を数える（入れ子も）', () => {
    const nested = GROUPED.replace('  group g "まとまり" { a; b }',
      '  group g "まとまり" { a; h }\n  group h "なか" { b; c }');
    expect(groupMembers(parseDiagram(nested), 'g').sort()).toEqual(['a', 'b', 'c', 'h']);
  });

  it('複数のピンが 1 回の書き換えで動く', () => {
    const file = parseDiagram(GROUPED);
    const written = applyEdit(GROUPED, pinNodes(file, GROUPED, new Map([
      ['a', { x: 40, y: 30 }],
      ['b', { x: 40, y: 110 }],
      ['g', { x: 30, y: 20 }],
    ])));
    expect(layout(written)).toEqual([
      'layout {',
      '  a @ ( 40,  30)',
      '  b @ ( 40, 110)',
      '  g @ ( 30,  20) 200x200  z:-1',
      '}',
    ]);
  });

  it('留まっていない図形が混ざっても 1 回で入る', () => {
    const file = parseDiagram(GROUPED);
    const written = applyEdit(GROUPED, pinNodes(file, GROUPED, new Map([
      ['a', { x: 40, y: 30 }],
      ['c', { x: 200, y: 200 }],
    ])));
    expect(layout(written)).toContain('  a @ ( 40,  30)');
    expect(layout(written)).toContain('  c @ (200, 200)');
  });

  it('まとめて消しても、グループは両方の名前を失う', () => {
    const written = applyEdit(GROUPED, removeNodes(parseDiagram(GROUPED), GROUPED, ['a', 'b']));
    const file = parseDiagram(written);
    expect(file.nodes.map(n => n.id)).toEqual(['c', 'g']);
    expect(file.nodes.find(n => n.id === 'g')!.children).toEqual([]);
    expect(file.layout.has('a')).toBe(false);
    expect(file.layout.has('b')).toBe(false);
  });

  it('グループにするのは 1 行足すだけ（中身は動かない）', () => {
    const source = 'free {\n  a [A]\n  b [B]\n}\n\nlayout {\n  a @ (10, 10)\n  b @ (10, 90)\n}';
    const written = applyEdit(source, groupNodes(parseDiagram(source), source, ['a', 'b'], 'まとまり'));
    expect(written).toContain('  group group1 "まとまり" { a; b }');
    const file = parseDiagram(written);
    expect(file.nodes.find(n => n.id === 'group1')!.children).toEqual(['a', 'b']);
    expect(file.layout.get('a')).toMatchObject({ x: 10, y: 10 });
  });

  it('1 つではグループにしない', () => {
    expect(() => groupNodes(parseDiagram(GROUPED), GROUPED, ['a'], 'x')).toThrow(DiagramEditError);
  });

  it('グループを消しても中身は残る（＝解除）', () => {
    const written = applyEdit(GROUPED, removeNode(parseDiagram(GROUPED), GROUPED, 'g'));
    const file = parseDiagram(written);
    expect(file.nodes.map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(file.layout.get('a')).toMatchObject({ x: 10, y: 10 });
  });
});
