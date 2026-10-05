import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import { parseDiagram } from '@docpresenter/diagram';
import {
  addNode, bendEdge, canUnpin, connectNodes, DiagramEditError, disconnectNodes, groupMembers,
  dropInto, groupNodes, layOutDiagram, moveCallout, pinNode, pinNodes, reconnect, removeNode,
  putIntoContainer, removeNodes, setContainerCells, setItems, setNodeShape, setNodeStyle,
  setNodePart, setNodeText, unpinNode, withParts,
} from '../src/index.js';
import type { Item } from '../src/model.js';

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

  it('名前を変えても桁は揃ったまま', () => {
    // 図の記法は桁を揃えて書かれる。1 行だけ左に寄ると、差分に読む必要のない
    // 行が出る。元の行を見せれば、間の空白はそのまま使える。
    const source = 'free {\n  db      [(会員 DB)]\n  cache   [(セッション)]\n}';
    const written = applyEdit(source, setNodeText(parseDiagram(source), 'db', '会員データベース', source));
    expect(written).toContain('  db      [(会員データベース)]');
  });

  it('元の行を渡さなければ空白ひとつ', () => {
    const source = 'free {\n  db      [(会員 DB)]\n}';
    const written = applyEdit(source, setNodeText(parseDiagram(source), 'db', 'X'));
    expect(written).toContain('  db [(X)]');
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

describe('線を折る', () => {
  const SOURCE = [
    'free {', '  a [A]', '  b [B]', '  a --> b', '}', '',
    'layout {', '  a @ (0, 0)', '  b @ (300, 300)', '}',
  ].join('\n');

  it('折れ点は layout に 1 行', () => {
    const written = run(SOURCE, f => bendEdge(f, SOURCE, 'a', 'b', [{ x: 0, y: 300 }]));
    expect(layout(written)).toContain('  a -> b @ (0, 300)');
    expect(parseDiagram(written).bends.get('a->b')?.points).toEqual([{ x: 0, y: 300 }]);
  });

  it('動かすのは同じ 1 行', () => {
    const once = run(SOURCE, f => bendEdge(f, SOURCE, 'a', 'b', [{ x: 0, y: 300 }]));
    const twice = applyEdit(once,
      bendEdge(parseDiagram(once), once, 'a', 'b', [{ x: 20, y: 300 }, { x: 20, y: 320 }]));
    expect(layout(twice)).toEqual([
      'layout {', '  a @ (0, 0)', '  b @ (300, 300)', '  a -> b @ (20, 300); (20, 320)', '}',
    ]);
  });

  it('空にすると行ごと消える（＝まっすぐに戻る）', () => {
    const once = run(SOURCE, f => bendEdge(f, SOURCE, 'a', 'b', [{ x: 0, y: 300 }]));
    const back = applyEdit(once, bendEdge(parseDiagram(once), once, 'a', 'b', []));
    expect(back).toBe(SOURCE);
  });

  it('無い線は折れない', () => {
    expect(() => bendEdge(parseDiagram(SOURCE), SOURCE, 'b', 'a', [{ x: 0, y: 0 }]))
      .toThrow(DiagramEditError);
  });
});

describe('折れ点の後始末', () => {
  const SOURCE = [
    'free {', '  a [A]', '  b [B]', '  c [C]', '  a --> b', '}', '',
    'layout {', '  a @ (0, 0)', '  b @ (300, 300)', '  a -> b @ (0, 300)', '}',
  ].join('\n');

  it('線を消すと折れ点の行も消える', () => {
    const written = applyEdit(SOURCE, disconnectNodes(parseDiagram(SOURCE), SOURCE, 'a', 'b'));
    expect(written).not.toContain('->');
    expect(parseDiagram(written).bends.size).toBe(0);
  });

  it('図形を消すと、その線の折れ点も消える', () => {
    const written = applyEdit(SOURCE, removeNode(parseDiagram(SOURCE), SOURCE, 'b'));
    expect(parseDiagram(written).bends.size).toBe(0);
    expect(parseDiagram(written).edges).toHaveLength(0);
  });

  it('つなぎ替えると折れ点も新しい名前になる', () => {
    const written = applyEdit(SOURCE,
      reconnect(parseDiagram(SOURCE), SOURCE, { from: 'a', to: 'b' }, { to: 'c' }));
    expect(parseDiagram(written).bends.get('a->c')?.points).toEqual([{ x: 0, y: 300 }]);
    expect(parseDiagram(written).bends.has('a->b')).toBe(false);
  });
});

describe('部品を足す', () => {
  const BARE = 'free {\n  a [A]\n}';

  it('図形の行・ピン・絵の指定が 1 回で入る', () => {
    const source = 'free {\n  a [A]\n}\n\nlayout {\n  a @ (0, 0)\n}\n\nstyle {\n  theme: default\n}';
    const written = applyEdit(source, addNode(parseDiagram(source), source, {
      shape: 'text', text: 'ルータ', at: { x: 40, y: 120 }, icon: 'net/router',
    }));
    const file = parseDiagram(written);
    expect(file.nodes.map(n => n.id)).toEqual(['a', 'part1']);
    expect(file.layout.get('part1')).toMatchObject({ x: 40, y: 120 });
    expect(file.style.get('part1')?.get('icon')).toBe('net/router');
  });

  it('セクションが無ければ、まとめて 1 回で作る', () => {
    const written = applyEdit(BARE, addNode(parseDiagram(BARE), BARE, {
      shape: 'text', text: 'ルータ', at: { x: 10, y: 10 }, icon: 'net/router',
    }));
    expect(written).toContain('layout {');
    expect(written).toContain('style {');
    const file = parseDiagram(written);
    expect(file.layout.get('part1')).toMatchObject({ x: 10, y: 10 });
    expect(file.style.get('part1')?.get('icon')).toBe('net/router');
  });

  it('部品の名前は part1, part2', () => {
    const once = applyEdit(BARE, addNode(parseDiagram(BARE), BARE, {
      shape: 'text', text: '一', icon: 'net/router', at: { x: 0, y: 0 },
    }));
    const twice = applyEdit(once, addNode(parseDiagram(once), once, {
      shape: 'text', text: '二', icon: 'net/switch', at: { x: 0, y: 40 },
    }));
    expect(parseDiagram(twice).nodes.map(n => n.id)).toEqual(['a', 'part1', 'part2']);
  });
});

describe('見た目を変える', () => {
  const LINE = [
    'free {',
    '  rule1 --',
    '  box1  [箱]',
    '}',
    '',
    'layout {',
    '  rule1 @ (0, 0) 240x0',
    '  box1  @ (0, 40)',
    '}',
    '',
    'style {',
    '  rule1 { line: #d3d7dd }',
    '}',
  ].join('\n');

  // 閉じ括弧は宣言の中にもあるので、行で切る。
  const style = (source: string): string[] => {
    const lines = source.split('\n');
    const from = lines.findIndex(line => line.startsWith('style {'));
    return from < 0 ? [] : lines.slice(from, lines.indexOf('}', from) + 1);
  };

  it('既にある規則に足す', () => {
    const written = run(LINE, f => setNodeStyle(f, LINE, 'rule1', { arrow: 'end', weight: '2' }));
    expect(style(written)).toContain('  rule1 { line: #d3d7dd, arrow: end, weight: 2 }');
    // 書き換わるのはその 1 行だけ。図形の行も配置の行もそのまま。
    expect(written).toContain('  rule1 --');
    expect(written).toContain('  rule1 @ (0, 0) 240x0');
  });

  it('規則の無い図形には規則が増える', () => {
    const written = run(LINE, f => setNodeStyle(f, LINE, 'box1', { fill: '#eef3f9' }));
    expect(style(written)).toContain('  box1 { fill: #eef3f9 }');
    expect(style(written)).toContain('  rule1 { line: #d3d7dd }');
  });

  it('宣言を外せる。空になった規則は行ごと消える', () => {
    const written = run(LINE, f => setNodeStyle(f, LINE, 'rule1', { line: undefined }));
    expect(written).not.toContain('rule1 {');
    expect(written).toContain('rule1 --');
  });

  it('いちどに外すものが 2 つあっても、2 つとも外れる', () => {
    const two = applyEdit(LINE, setNodeStyle(parseDiagram(LINE), LINE, 'rule1', { arrow: 'end' }));
    const written = applyEdit(two,
      setNodeStyle(parseDiagram(two), two, 'rule1', { arrow: undefined, line: undefined }));
    expect(written).not.toContain('rule1 {');
  });

  it('style セクションが無ければ書き足す', () => {
    const bare = 'free {\n  rule1 --\n}\n';
    const written = applyEdit(bare, setNodeStyle(parseDiagram(bare), bare, 'rule1', { weight: '4' }));
    expect(written).toContain('style {\n  rule1 { weight: 4 }\n}');
  });

  it('同じ値を書こうとしたら、何も書かずに断る', () => {
    expect(() => setNodeStyle(parseDiagram(LINE), LINE, 'rule1', { line: '#d3d7dd' }))
      .toThrow(DiagramEditError);
  });

  it('知らない図形には書かない', () => {
    expect(() => setNodeStyle(parseDiagram(LINE), LINE, 'nope', { weight: '2' }))
      .toThrow(DiagramEditError);
  });

  it('線を足すと、角括弧ではなく二重線で書かれる', () => {
    const written = applyEdit(SCREEN, addNode(parseDiagram(SCREEN), SCREEN, {
      shape: 'line', text: '', at: { x: 60, y: 300 },
    }));
    expect(written).toContain('  rule1 --');
    expect(written).toContain('rule1 @ (60, 300)');
  });
});

describe('入れ物からの削除', () => {
  const HELD = [
    'free {',
    '  frame [ ]',
    '  a [あ]',
    '  b [い]',
    '  c [う]',
    '}',
    '',
    'layout {',
    '  frame @ (0, 0) 300x400',
    '',
    '  grid frame (cols: 1fr, 1fr; pad: 10) {',
    '    a ; b',
    '    c ; .',
    '  }',
    '}',
    '',
  ].join('\n');

  it('消した図形の名前は入れ物からも消える。grid は形を保つ', () => {
    const written = run(HELD, f => removeNodes(f, HELD, ['b']));
    expect(written).toContain('    a ; .');
    expect(written).toContain('    c ; .');
    expect(written).not.toContain('b [い]');
  });

  it('stack は並びなので、名前ごと抜ける', () => {
    const stacked = HELD.replace(/  grid frame[\s\S]*?\n  \}/, '  stack frame (down) { a ; b ; c }');
    const written = run(stacked, f => removeNodes(f, stacked, ['b']));
    expect(written).toContain('stack frame (down) { a ; c }');
  });

  it('入れ物そのものを消せば、並べ方の行も消える', () => {
    const written = run(HELD, f => removeNodes(f, HELD, ['frame']));
    expect(written).not.toContain('grid frame');
    expect(written).toContain('a [あ]');
  });

  it('入れ物の中の図形は、ピンを外して並びに戻せる', () => {
    const pinned = HELD.replace('  frame @ (0, 0) 300x400', '  frame @ (0, 0) 300x400\n  a @ (500, 500)');
    expect(canUnpin(parseDiagram(pinned), 'a')).toBe(true);
    const written = run(pinned, f => unpinNode(f, pinned, 'a'));
    expect(written).not.toContain('a @ (500, 500)');
    expect(written).toContain('    a ; b');
  });
});

describe('入れ物の中での並べ替え', () => {
  const HELD = [
    'free {',
    '  frame [ ]',
    '  a [あ]',
    '  b [い]',
    '  c [う]',
    '}',
    '',
    'layout {',
    '  frame @ (0, 0) 300x400',
    '',
    '  stack frame (down; gap: 10; pad: 10) {',
    '    a',
    '    b',
    '    c',
    '  }',
    '}',
    '',
  ].join('\n');

  const at = (source: string, id: string, dy = 0) => {
    const laid = layOutDiagram(parseDiagram(source));
    const box = laid.boxes.get(id)!;
    return { x: box.x + box.width / 2, y: box.y + dy };
  };
  const drop = (source: string, moving: string, to: { x: number; y: number }) => {
    const file = parseDiagram(source);
    const laid = layOutDiagram(file);
    return dropInto(
      file.containers.get('frame')!, laid.boxes.get('frame')!,
      id => laid.boxes.get(id), moving, to, laid.holes);
  };

  // 外から入れるのも同じ手つき。入れ物に入れる口はこれしかないので、
  // これが効かないと「足したものを入れ物に入れる」方法が無くなる。
  describe('外から入れる', () => {
    const OUT = HELD.replace('  c [う]', '  c [う]\n  loose [はぐれ]')
      .replace('  frame @ (0, 0) 300x400', '  frame @ (0, 0) 300x400\n  loose @ (500, 500) 80x20');

    it('並びの中に落とせば、その場所に入る', () => {
      expect(drop(OUT, 'loose', at(OUT, 'b', 2))?.cells).toEqual([['a'], ['loose'], ['b'], ['c']]);
    });

    it('格子は空いているセルにだけ入る', () => {
      const grid = OUT
        .replace(/  stack frame[\s\S]*?\n  \}/, '  grid frame (cols: 1fr, 1fr) {\n    a ; b\n    c ; .\n  }');
      const laid = layOutDiagram(parseDiagram(grid));
      const hole = laid.holes[0]!;
      expect(laid.holes.length).toBe(1);
      const into = drop(grid, 'loose', { x: hole.box.x + 4, y: hole.box.y + 4 });
      expect(into?.cells).toEqual([['a', 'b'], ['c', 'loose']]);
      // 埋まっているセルの上では何も起きない——相手を押し出すことになる
      expect(drop(grid, 'loose', at(grid, 'b'))).toBeUndefined();
    });

    it('空のセルは、入れ物が置いた場所にある', () => {
      const grid = OUT
        .replace(/  stack frame[\s\S]*?\n  \}/, '  grid frame (cols: 1fr, 1fr) {\n    a ; b\n    c ; .\n  }');
      const laid = layOutDiagram(parseDiagram(grid));
      const hole = laid.holes[0]!;
      const b = laid.boxes.get('b')!;
      const c = laid.boxes.get('c')!;
      expect(hole.row).toBe(1);
      expect(hole.col).toBe(1);
      expect(Math.round(hole.box.x)).toBe(Math.round(b.x));
      expect(Math.round(hole.box.y)).toBe(Math.round(c.y));
    });
  });

  it('上半分に落とせばその前、下半分なら後ろ', () => {
    expect(drop(HELD, 'c', at(HELD, 'a', 2))?.cells).toEqual([['c'], ['a'], ['b']]);
    expect(drop(HELD, 'a', at(HELD, 'c', 2))?.cells).toEqual([['b'], ['a'], ['c']]);
  });

  it('いまと同じ並びになる落とし方は、落とし先にしない', () => {
    expect(drop(HELD, 'a', at(HELD, 'a', 2))).toBeUndefined();
  });

  it('grid は場所を交換する（穴を空けない）', () => {
    const grid = HELD.replace(
      /  stack frame[\s\S]*?\n  \}/,
      '  grid frame (gap: 0 0; pad: 0) {\n    a ; b\n    c ; .\n  }');
    const laid = layOutDiagram(parseDiagram(grid));
    const b = laid.boxes.get('b')!;
    const found = drop(grid, 'a', { x: b.x + 2, y: b.y + 2 });
    expect(found?.cells).toEqual([['b', 'a'], ['c', '.']]);
  });

  it('書き換わるのは入れ物の 1 ブロックだけ', () => {
    const file = parseDiagram(HELD);
    const edit = setContainerCells(file, HELD, 'frame', [['c'], ['a'], ['b']]);
    const written = applyEdit(HELD, edit);
    expect(written).toContain('  stack frame (down; gap: 10; pad: 10) {\n    c\n    a\n    b\n  }');
    // 図形の行も枠のピンも 1 文字も動かない
    expect(written).toContain('  a [あ]');
    expect(written).toContain('  frame @ (0, 0) 300x400');
    expect(edit.description).toBe('並びを変える');
  });

  it('1 行で書かれた入れ物は 1 行のまま', () => {
    const inline = HELD.replace(/  stack frame[\s\S]*?\n  \}/, '  stack frame (down) { a ; b ; c }');
    const written = applyEdit(inline,
      setContainerCells(parseDiagram(inline), inline, 'frame', [['b'], ['a'], ['c']]));
    expect(written).toContain('stack frame (down) { b ; a ; c }');
  });

  it('同じ並びを書こうとしたら断る', () => {
    expect(() => setContainerCells(parseDiagram(HELD), HELD, 'frame', [['a'], ['b'], ['c']]))
      .toThrow(DiagramEditError);
  });
});

describe('一覧の行を変える', () => {
  const ROWS = [
    'use "default"',
    '',
    'free {',
    '  nav tree: {',
    '    - 全社',
    '      - 営業',
    '      - 管理 *',
    '  }',
    '  bare list:',
    '  plain [ふつうの図形]',
    '}',
    '',
  ].join('\n');

  const rowsOf = (text: string, id = 'nav'): readonly Item[] =>
    parseDiagram(text).nodes.find(one => one.id === id)!.items;
  const write = (text: string, id: string, items: readonly Item[]): string =>
    applyEdit(text, setItems(parseDiagram(text), text, id, items));

  it('行を足しても、書き換わるのはその一覧だけ', () => {
    const items = rowsOf(ROWS);
    const edit = setItems(parseDiagram(ROWS), ROWS, 'nav', [
      ...items.slice(0, 2),
      { text: '新しい行', depth: 1, closed: false, picked: false },
      items[2]!,
    ]);
    const written = applyEdit(ROWS, edit);
    expect(edit.description).toBe('一覧を変える');
    expect(written).toContain('      - 営業\n      - 新しい行\n      - 管理 *');
    // ほかの行は 1 文字も動かない
    expect(written).toContain('  bare list:');
    expect(written).toContain('  plain [ふつうの図形]');
  });

  it('字下げの幅は、書かれているものに合わせる', () => {
    const wide = ROWS.replace('      - 営業', '        - 営業').replace('      - 管理 *', '        - 管理 *');
    const items = rowsOf(wide);
    expect(items.map(one => one.depth)).toEqual([0, 1, 1]);
    const written = write(wide, 'nav', [...items,
      { text: '総務', depth: 1, closed: false, picked: false }]);
    expect(written).toContain('        - 総務');
  });

  it('印は印として書き戻される', () => {
    const items = rowsOf(ROWS);
    const written = write(ROWS, 'nav', items.map((one, i) => (
      i === 1 ? { ...one, closed: true, picked: true } : { ...one, picked: false })));
    expect(written).toContain('      + 営業 *');
    expect(written).toContain('      - 管理\n');
  });

  it('行の無い部品にも書ける。書いたらブロックができる', () => {
    const written = write(ROWS, 'bare',
      [{ text: '最初の行', depth: 0, closed: false, picked: true }]);
    expect(written).toContain('  bare list: {\n    - 最初の行 *\n  }');
    expect(rowsOf(written, 'bare').map(one => one.text)).toEqual(['最初の行']);
  });

  it('空にしたら、ブロックごと消える', () => {
    const written = write(ROWS, 'nav', []);
    expect(written).toContain('  nav tree:\n');
    expect(written).not.toContain('全社');
    expect(rowsOf(written).length).toBe(0);
  });

  it('同じ行を書こうとしたら断る', () => {
    expect(() => setItems(parseDiagram(ROWS), ROWS, 'nav', rowsOf(ROWS)))
      .toThrow(DiagramEditError);
  });

  it('無い図形には書けない', () => {
    expect(() => setItems(parseDiagram(ROWS), ROWS, 'nope', []))
      .toThrow(DiagramEditError);
  });
});

describe('部品を変える', () => {
  const SCREEN = [
    'use "default"',
    '',
    'free {',
    '  dept   select:"情報システム部"',
    '  nav    tree: {',
    '    - 全社',
    '  }',
    '  plain  [ふつうの箱]',
    '  tagged [色つき]:::warn',
    '}',
    '',
  ].join('\n');
  const write = (text: string, id: string, part: string): string =>
    applyEdit(text, setNodePart(parseDiagram(text), text, id, part));

  it('書き換わるのは部品の名前だけ', () => {
    const written = write(SCREEN, 'dept', 'checkbox');
    expect(written).toContain('  dept   checkbox:"情報システム部"');
    expect(written).toContain('  plain  [ふつうの箱]');
  });

  it('行を持つ部品は、行ごと残る', () => {
    const written = write(SCREEN, 'nav', 'list');
    expect(written).toContain('  nav    list: {\n    - 全社\n  }');
  });

  it('部品でない図形は、部品になる（文字はそのまま）', () => {
    expect(write(SCREEN, 'plain', 'textbox')).toContain('  plain  textbox:"ふつうの箱"');
  });

  it('クラスは落とさない', () => {
    const written = write(SCREEN, 'tagged', 'label');
    expect(written).toContain('  tagged label:"色つき":::warn');
    expect(parseDiagram(written).nodes.find(one => one.id === 'tagged')?.className).toBe('warn');
  });

  it('同じ部品にはできない', () => {
    expect(() => setNodePart(parseDiagram(SCREEN), SCREEN, 'dept', 'select'))
      .toThrow(DiagramEditError);
  });

  // 図形の種類を変えると部品ではなくなる。消えるのは絵の出どころなので、
  // 何が起きたかを名前で言う——黙って捨てないため。
  it('図形の種類を変えると、部品をやめたと言う', () => {
    const file = parseDiagram(SCREEN);
    expect(setNodeShape(file, 'dept', 'ellipse').description).toBe('部品をやめて図形にする');
    expect(setNodeShape(file, 'plain', 'ellipse').description).toBe('図形の種類を変更');
  });

  it('行を持つ部品の種類は変えられない（行ごと消えるため）', () => {
    expect(() => setNodeShape(parseDiagram(SCREEN), 'nav', 'ellipse')).toThrow(DiagramEditError);
  });

  it('使える部品は、使っているライブラリが決める', () => {
    const library = withParts(parseDiagram(SCREEN), () => undefined);
    expect(library.library.get('textbox')).toBeDefined();
    // 見出し（# --- 入力 ---）はそのまま区分になる
    expect(library.library.get('textbox')?.group).toBe('入力');
    expect(library.library.get('primary')?.group).toBe('ボタン');
  });
});

describe('入れ物に入れる', () => {
  const HOLDS = [
    'use "default"',
    '',
    'free {',
    '  frame [ ]',
    '  a [あ]',
    '  b [い]',
    '  loose [はぐれ]',
    '}',
    '',
    'layout {',
    '  frame @ (0, 0) 300x400',
    '  loose @ (500, 500) 80x20',
    '  stack frame (down; gap: 10; pad: 10) { a ; b }',
    '}',
    '',
  ].join('\n');

  it('名前が並びに入り、ピンの行は消える', () => {
    const file = parseDiagram(HOLDS);
    const edit = putIntoContainer(file, HOLDS, 'frame', [['a'], ['loose'], ['b']], 'loose');
    const written = applyEdit(HOLDS, edit);
    expect(edit.description).toBe('入れ物に入れる');
    expect(written).toContain('{ a ; loose ; b }');
    expect(written).not.toContain('loose @');
    expect(written).toContain('  frame @ (0, 0) 300x400');
  });

  it('既に中にいるものは入れ直せない', () => {
    expect(() => putIntoContainer(parseDiagram(HOLDS), HOLDS, 'frame', [['a']], 'a'))
      .toThrow(DiagramEditError);
  });

  it('足すものは、選んだものの次に入る', () => {
    const written = applyEdit(HOLDS, addNode(parseDiagram(HOLDS), HOLDS,
      { shape: 'rect', text: '', part: 'textbox', into: { container: 'frame', after: 'a' } }));
    expect(written).toContain('{ a ; part1 ; b }');
    expect(written).toContain('  part1 textbox:');
    // 入れ物が置くので、座標は 1 つも増えない
    expect((written.match(/@ \(/g) ?? []).length).toBe(2);
  });

  it('格子は空いているセルに入れ、空きが無ければ 1 行増やす', () => {
    const grid = HOLDS.replace('stack frame (down; gap: 10; pad: 10) { a ; b }',
      'grid frame (cols: 1fr, 1fr) {\n    a ; .\n  }');
    const once = applyEdit(grid, addNode(parseDiagram(grid), grid,
      { shape: 'rect', text: '', part: 'textbox', into: { container: 'frame' } }));
    expect(once).toContain('a ; part1');
    const twice = applyEdit(once, addNode(parseDiagram(once), once,
      { shape: 'rect', text: '', part: 'label', into: { container: 'frame' } }));
    expect(twice).toContain('a ; part1\n    part2 ; .');
  });
});
