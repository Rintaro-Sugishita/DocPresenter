import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sliceBytes } from '@docpresenter/base';
import {
  DiagramParseError, layOutDiagram, parseDiagram, parseRuns, specimenOf, withParts, wrapRuns,
  wrapText,
} from '../src/index.js';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('作図ファイルの解析', () => {
  it('括弧の種類が図形になる', () => {
    const d = parseDiagram('flow {\n a ([丸])\n b [(筒)]\n c {菱}\n d ((円))\n e >付箋]\n f (角丸)\n g [四角]\n}');
    expect(d.nodes.map(n => n.shape)).toEqual(
      ['stadium', 'cylinder', 'diamond', 'ellipse', 'note', 'round-rect', 'rect']);
  });

  it('接続の線種と矢印を読み分ける', () => {
    const d = parseDiagram('flow {\n a [A]\n b [B]\n a --> b "ラベル"\n a -- b\n a -.-> b\n}');
    expect(d.edges.map(({ span, ...rest }) => rest)).toEqual([
      { from: 'a', to: 'b', label: 'ラベル', line: 'solid', arrow: 'arrow' },
      { from: 'a', to: 'b', label: undefined, line: 'solid', arrow: 'none' },
      { from: 'a', to: 'b', label: undefined, line: 'dashed', arrow: 'arrow' },
    ]);
    // それぞれが自分の行を指している（1 本消すのに 1 行だけ触れる）。
    expect(d.edges.map(e => e.span.start)).toEqual([...new Set(d.edges.map(e => e.span.start))]);
  });

  it('意味と配置が別の層に入る', () => {
    const d = parseDiagram('free {\n a [A]\n}\nlayout {\n a @ (10, 20) 100x50 z:-1\n}');
    expect(d.nodes[0]?.text).toBe('A');
    expect(d.layout.get('a')).toMatchObject({ x: 10, y: 20, width: 100, height: 50, z: -1 });
  });

  it('overlay は画像と注釈を読む', () => {
    const d = parseDiagram(read('sample/docs/auth-design/login-screen-overlay.dgm'));
    expect(d.mode).toBe('overlay');
    expect(d.image).toBe('../assets/login-screen.png');
    expect(d.callouts).toHaveLength(4);
    expect(d.callouts[0]).toMatchObject({ marker: '①', x: 168, y: 126, text: 'ログイン ID' });
  });

  it('読めない行は黙って捨てずに落ちる', () => {
    expect(() => parseDiagram('flow {\n a ?? b\n}')).toThrow(/2 行目/);
  });

  it('図形も配置もない場合は誤りとして扱う', () => {
    expect(() => parseDiagram('style {\n theme: default\n}')).toThrow();
  });
});

describe('レイアウトの算出', () => {
  it('自由配置はピン留めをそのまま使う', () => {
    const d = parseDiagram(read('sample/shared/system-architecture.dgm'));
    const laid = layOutDiagram(d);
    const browser = laid.boxes.get('browser');
    const web = laid.boxes.get('web');
    // 原点合わせで平行移動するが、相対位置は書いたとおりに保たれる。
    expect(web!.x - browser!.x).toBe(200);
    expect(browser!.width).toBe(140);
    expect(laid.diagnostics).toEqual([]);
  });

  it('グループは中身より奥に置かれる', () => {
    const d = parseDiagram(read('sample/shared/system-architecture.dgm'));
    const laid = layOutDiagram(d);
    expect(laid.boxes.get('intra')!.z).toBe(-1);
    expect(laid.order.indexOf('intra')).toBeLessThan(laid.order.indexOf('api'));
  });

  it('グラフは階層に分けて自動配置する', () => {
    const d = parseDiagram(read('sample/docs/auth-design/login-flow.dgm'));
    const laid = layOutDiagram(d);
    const y = (id: string): number => laid.boxes.get(id)!.y;
    expect(y('start')).toBeLessThan(y('login'));
    expect(y('login')).toBeLessThan(y('validate'));
    expect(y('validate')).toBeLessThan(y('authapi'));
  });

  it('ピン留めした要素は自動配置に上書きされない', () => {
    const d = parseDiagram(read('sample/docs/auth-design/login-flow.dgm'));
    const laid = layOutDiagram(d);
    const home = laid.boxes.get('home')!;
    const locked = laid.boxes.get('locked')!;
    expect(locked.x - home.x).toBe(220);
    expect(locked.y).toBe(home.y);
  });

  it('循環があっても停止する', () => {
    const d = parseDiagram(read('sample/docs/auth-design/token-lifecycle.dgm'));
    const laid = layOutDiagram(d);
    expect(laid.boxes.size).toBe(4);
    expect(laid.boxes.get('issued')!.y).toBeLessThan(laid.boxes.get('active')!.y);
  });

  it('自由配置で置き場所のない要素は、報告したうえで図の下に並べる', () => {
    const d = parseDiagram('free {\n a [A]\n b [B]\n}\nlayout {\n a @ (0, 0)\n}');
    const laid = layOutDiagram(d);
    // 消してしまうと、ファイルにある図形が画面から消える。掴めなければ直せない。
    expect(laid.boxes.has('b')).toBe(true);
    expect(laid.boxes.get('b')!.y).toBeGreaterThan(laid.boxes.get('a')!.y);
    expect(laid.diagnostics).toContain('配置がない: b');
  });

  it('存在しない接続先を報告する', () => {
    const d = parseDiagram('flow {\n a [A]\n a --> z\n}');
    expect(layOutDiagram(d).diagnostics).toContain('接続先が見つからない: z');
  });
});

describe('ラベルの折り返し', () => {
  it('和文は任意の位置で折り返す', () => {
    expect(wrapText('認証失敗の表示', 56, 14)).toEqual(['認証失敗', 'の表示']);
  });

  it('行頭に来られない文字は前の行に残す', () => {
    // 「エラ／ー表示」と割れてしまうと日本語として読めない。
    expect(wrapText('認証エラー表示', 56, 14)).toEqual(['認証エラー', '表示']);
  });

  it('欧文は単語を割らない', () => {
    expect(wrapText('access token', 70, 14)).toEqual(['access', 'token']);
  });
});

describe('折れ線', () => {
  const SOURCE = [
    'free {', '  a [A]', '  b [B]', '  a --> b', '}', '',
    'layout {', '  a @ (0, 0)', '  b @ (300, 300)', '  a -> b @ (0, 300)', '}',
  ].join('\n');

  it('折れ点を読む', () => {
    const d = parseDiagram(SOURCE);
    expect(d.bends.get('a->b')?.points).toEqual([{ x: 0, y: 300 }]);
    expect(d.layout.has('a')).toBe(true);
  });

  it('折れ点を通る経路になる', () => {
    const laid = layOutDiagram(parseDiagram(SOURCE));
    const route = laid.routes[0]!;
    expect(route.points).toHaveLength(3);
    expect(route.points[1]).toEqual({
      x: 0 + laid.origin.x, y: 300 + laid.origin.y,
    });
  });

  it('折れ点が無ければこれまで通り 2 点', () => {
    const laid = layOutDiagram(parseDiagram(SOURCE.replace('  a -> b @ (0, 300)\n', '')));
    expect(laid.routes[0]!.points).toHaveLength(2);
  });
});

describe('フローの線は縦と横だけで引く', () => {
  const laid = (body: string[], layout: string[] = []) => layOutDiagram(parseDiagram([
    'flow {', ...body, '}',
    ...(layout.length === 0 ? [] : ['layout {', ...layout, '}']),
  ].join('\n')));

  it('段がずれていれば、段の間の真ん中で横に折れる', () => {
    const d = laid(['  a [A]', '  b [B]', '  c [C]', '  a --> b', '  a --> c']);
    const route = d.routes[0]!;
    const a = d.boxes.get('a')!;
    const b = d.boxes.get('b')!;
    expect(route.points).toHaveLength(4);
    const [start, turn, across, end] = route.points;
    expect(turn!.x).toBe(start!.x);                       // 下へ
    expect(across!.y).toBe(turn!.y);                      // 横へ
    expect(end!.x).toBe(across!.x);                       // また下へ
    expect(turn!.y).toBe((a.y + a.height + b.y) / 2);     // 段の間の真ん中
  });

  it('真下にあれば 1 本の直線', () => {
    const d = laid(['  a [A]', '  b [B]', '  a --> b']);
    expect(d.routes[0]!.points).toHaveLength(2);
  });

  it('横に並んでいれば、横・縦・横に折れる', () => {
    const d = laid(['  a [A]', '  b [B]', '  a --> b'], ['  a @ (0, 0)', '  b @ (300, 30)']);
    const [start, turn, across, end] = d.routes[0]!.points;
    expect(turn!.y).toBe(start!.y);
    expect(across!.x).toBe(turn!.x);
    expect(end!.y).toBe(across!.y);
  });

  it('自由配置の図は、これまで通り直線', () => {
    const d = layOutDiagram(parseDiagram([
      'free {', '  a [A]', '  b [B]', '  a --> b', '}',
      'layout {', '  a @ (0, 0)', '  b @ (300, 200)', '}',
    ].join('\n')));
    expect(d.routes[0]!.points).toHaveLength(2);
  });
});

describe('フローチャートの図形', () => {
  it('Mermaid の括弧をそのまま読む', () => {
    const d = parseDiagram([
      'flow {',
      '  a [/入出力/]',
      '  b {{準備}}',
      '  c [/ループ開始\\]',
      '  d [\\ループ終了/]',
      '}',
    ].join('\n'));
    expect(d.nodes.map(n => [n.shape, n.text])).toEqual([
      ['parallelogram', '入出力'],
      ['hexagon', '準備'],
      ['loop-start', 'ループ開始'],
      ['loop-end', 'ループ終了'],
    ]);
  });
});

describe('ラベルの書式', () => {
  const runs = (text: string) => parseRuns(text).map(r =>
    [r.text, r.bold ? 'b' : '', r.italic ? 'i' : '', r.code ? 'c' : '', r.colour ?? ''].join('|'));

  it('太字・斜体・コード・色を読む', () => {
    expect(runs('**強い**')).toEqual(['強い|b|||']);
    expect(runs('*弱い*')).toEqual(['弱い||i||']);
    expect(runs('`code`')).toEqual(['code|||c|']);
    expect(runs('[赤]{color=#c62828}')).toEqual(['赤||||#c62828']);
  });

  it('閉じていない印はただの文字', () => {
    expect(runs('2 * 3 = 6')).toEqual(['2 * 3 = 6||||']);
    expect(runs('user_id_1')).toEqual(['user_id_1||||']);
  });

  it('入れ子と逃げ道', () => {
    expect(runs('**[強い赤]{color=#f00}**')).toEqual(['強い赤|b|||#f00']);
    expect(runs('\\*そのまま\\*')).toEqual(['*そのまま*||||']);
  });

  it('折り返しても書式は保たれる', () => {
    const lines = wrapRuns(parseRuns('**あいうえお**かきくけこ'), 5 * 14, 14);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.every(run => run.bold)).toBe(true);
    expect(lines[1]!.every(run => run.bold)).toBe(false);
  });

  it('大きさは見える文字で決まる（印は数えない）', () => {
    const marked = layOutDiagram(parseDiagram('flow {\n  a [**あいう**]\n}'));
    const plain = layOutDiagram(parseDiagram('flow {\n  a [あいう]\n}'));
    expect(marked.boxes.get('a')!.width).toBe(plain.boxes.get('a')!.width);
    expect(marked.boxes.get('a')!.height).toBe(plain.boxes.get('a')!.height);
  });
});

describe('単独の線', () => {
  it('二重線は図形として読む', () => {
    const file = parseDiagram('free {\n  rule1 --\n  rule2 ---\n}\n');
    expect(file.nodes.map(n => [n.id, n.shape, n.text]))
      .toEqual([['rule1', 'line', ''], ['rule2', 'line', '']]);
    expect(file.edges).toEqual([]);
  });

  it('接続より先に読む——id は「-」で終われるので、取り違えようがある', () => {
    // `rule2 ---` は「rule2 から - への接続」とも読めてしまう。そんな図形を
    // 誰も書いていない以上、読みは 1 つに決まる。
    const file = parseDiagram('flow {\n  a [あ]\n  rule2 ---\n  a --> a2\n  a2 [い]\n}\n');
    expect(file.edges.map(e => [e.from, e.to])).toEqual([['a', 'a2']]);
    expect(file.nodes.find(n => n.id === 'rule2')?.shape).toBe('line');
  });

  it('部品としても書ける', () => {
    const part = parseDiagram('parts {\n  divider -- { line: #d3d7dd } 320x0\n}\n')
      .parts.get('divider')!;
    expect(part.shape).toBe('line');
    expect([part.width, part.height]).toEqual([320, 0]);
  });

  it('文字を測らない。平らなまま置かれる', () => {
    const laid = layOutDiagram(parseDiagram('free {\n  rule1 --\n}\nlayout {\n  rule1 @ (0,0)\n}'));
    expect(laid.boxes.get('rule1')!.height).toBe(0);
  });

  it('読めない宣言は黙って捨てない', () => {
    const laid = layOutDiagram(parseDiagram(
      'free {\n  rule1 --\n  box1 [箱]\n}\n'
      + 'layout {\n  rule1 @ (0,0) 100x0\n  box1 @ (0,40)\n}\n'
      + 'style {\n  rule1 { arrow: ひだり, weight: 0 }\n  box1 { arrow: end }\n}\n'));
    expect(laid.diagnostics.join(' / ')).toContain('arrow に書けるのは');
    expect(laid.diagnostics.join(' / ')).toContain('太さは正の数で書く');
    expect(laid.diagnostics.join(' / ')).toContain('線だけが arrow を持つ: box1');
  });
});

describe('入れ物', () => {
  const box = (laid: ReturnType<typeof layOutDiagram>, id: string) => laid.boxes.get(id)!;
  const lay = (...lines: string[]) => layOutDiagram(parseDiagram(lines.join('\n')));

  it('縦に積む：間隔は 1 回だけ書き、座標は計算される', () => {
    const laid = lay(
      'free {', '  frame [ ]', '  a [あ]', '  b [い]', '  c [う]', '}',
      'layout {',
      '  frame @ (0, 0) 300x400',
      '  stack frame (down; gap: 10; pad: 20) { a ; b ; c }',
      '}');
    const [first, second, third] = [box(laid, 'a'), box(laid, 'b'), box(laid, 'c')];
    expect(second.y - (first.y + first.height)).toBe(10);
    expect(third.y - (second.y + second.height)).toBe(10);
    // 交差軸は伸びる：3 つとも枠いっぱいの同じ幅になる
    expect([first.width, second.width, third.width]).toEqual([260, 260, 260]);
    expect(first.x).toBe(box(laid, 'frame').x + 20);
  });

  it('横に並べる：主軸は部品のままの大きさ', () => {
    const laid = lay(
      'free {', '  row [ ]', '  a [あ]', '  b [い]', '}',
      'layout {',
      '  row @ (0, 0) 600x100',
      '  stack row (right; gap: 8; pad: 0) { a ; b }',
      '}');
    expect(box(laid, 'b').x - (box(laid, 'a').x + box(laid, 'a').width)).toBe(8);
    expect(box(laid, 'a').width).toBe(box(laid, 'b').width);   // 同じ中身なので同じ
    expect(box(laid, 'a').width).toBeLessThan(600);
  });

  it('grid：列の幅は宣言どおり、残りは 1fr が分け合う', () => {
    const laid = lay(
      'free {', '  form [ ]', '  l1 [ラベル]', '  f1 [入力]', '}',
      'layout {',
      '  form @ (0, 0) 400x200',
      '  grid form (cols: 100, 1fr; gap: 0 20; pad: 10) {',
      '    l1 ; f1',
      '  }',
      '}');
    expect(box(laid, 'l1').width).toBe(100);
    expect(box(laid, 'f1').width).toBe(400 - 20 - 20 - 100);   // pad*2, gap, ラベル列
    expect(box(laid, 'f1').x - box(laid, 'l1').x).toBe(120);
  });

  it('同じ名前を並べるとセルをまたぐ。. は空のセル', () => {
    const laid = lay(
      'free {', '  form [ ]', '  wide [見出し]', '  one [左]', '}',
      'layout {',
      '  form @ (0, 0) 400x200',
      '  grid form (gap: 0 0; pad: 0) {',
      '    wide ; wide',
      '    one  ; .',
      '  }',
      '}');
    expect(box(laid, 'wide').width).toBe(400);
    expect(box(laid, 'one').width).toBe(200);
  });

  it('入れ物は入れ子にできる。深さは名前で繋ぐので、ブロックは平らなまま', () => {
    const laid = lay(
      'free {', '  form [ ]', '  row [ ]', '  a [あ]', '  b [い]', '}',
      'layout {',
      '  form @ (0, 0) 300x200',
      '  stack form (down; gap: 0; pad: 0) { row }',
      '  stack row (right; gap: 0; pad: 0) { a ; b }',
      '}');
    expect(box(laid, 'row').width).toBe(300);
    expect(box(laid, 'a').y).toBe(box(laid, 'row').y);
    expect(box(laid, 'b').x).toBeGreaterThan(box(laid, 'a').x);
  });

  it('ピンが勝つ：置き場所を書いた図形は入れ物から出る', () => {
    const laid = lay(
      'free {', '  frame [ ]', '  a [あ]', '  b [い]', '}',
      'layout {',
      '  frame @ (0, 0) 300x400',
      '  b @ (500, 500) 80x20',
      '  stack frame (down; gap: 0; pad: 0) { a ; b }',
      '}');
    expect([box(laid, 'b').width, box(laid, 'b').height]).toEqual([80, 20]);
    expect(box(laid, 'b').x).toBeGreaterThan(box(laid, 'frame').x + 300);
  });

  it('読めないものは黙って捨てない', () => {
    const laid = lay(
      'free {', '  frame [ ]', '  a [あ]', '}',
      'layout {',
      '  frame @ (0, 0) 300x40',
      '  stack frame (down; gap: 0; pad: 0) { a ; いない }',
      '  stack どこにもない (down) { a }',
      '}');
    const said = laid.diagnostics.join(' / ');
    expect(said).toContain('入れ物の中身が見つからない: いない');
    expect(said).toContain('入れ物が見つからない: どこにもない');
  });

  it('枠に入りきらない中身は、描いたうえで言う', () => {
    const laid = lay(
      'free {', '  frame [ ]', '  a [あ]', '  b [い]', '}',
      'layout {',
      '  frame @ (0, 0) 300x60',
      '  stack frame (down; gap: 10; pad: 10) { a ; b }',
      '}');
    expect(laid.diagnostics.join(' / ')).toContain('入れ物に中身が入りきらない: frame');
    expect(laid.boxes.has('b')).toBe(true);       // 隠さない
  });

  it('入れ物の置き場所が無ければ、そう言う', () => {
    const laid = lay(
      'free {', '  frame [ ]', '  a [あ]', '}',
      'layout {',
      '  stack frame (down) { a }',
      '}');
    expect(laid.diagnostics.join(' / ')).toContain('入れ物の置き場所がない: frame');
  });

  it('tabs：見出しは全部、中身は 1 枚だけ', () => {
    const laid = lay(
      'free {', '  main [ ]', '  one [い]', '  two [に]', '  a [あ]', '  b [び]', '}',
      'layout {',
      '  main @ (0, 0) 300x200',
      '  tabs main (show: two) { one ; two }',
      '  stack one (down; pad: 0) { a }',
      '  stack two (down; pad: 0) { b }',
      '}');
    expect(laid.boxes.has('two')).toBe(true);
    expect(laid.boxes.has('b')).toBe(true);
    // 描かれない頁は、置き場所の無い図形として下に並べられたりもしない
    expect(laid.boxes.has('one')).toBe(false);
    expect(laid.boxes.has('a')).toBe(false);
    expect(laid.diagnostics).toEqual([]);
  });

  it('tabs：show を書かなければ先頭の頁', () => {
    const laid = lay(
      'free {', '  main [ ]', '  one [い]', '  two [に]', '}',
      'layout {', '  main @ (0, 0) 300x200', '  tabs main { one ; two }', '}');
    expect(laid.boxes.has('one')).toBe(true);
    expect(laid.boxes.has('two')).toBe(false);
  });

  it('tabs：頁は見出しの下に置かれる', () => {
    const laid = lay(
      'free {', '  main [ ]', '  one [い]', '}',
      'layout {', '  main @ (0, 0) 300x200', '  tabs main { one }', '}');
    expect(laid.boxes.get('one').y - laid.boxes.get('main').y).toBe(26);
  });

  it('scroll：入りきらない行は描かれない。入れ物は注記を出さない', () => {
    const laid = lay(
      'free {', '  list [ ]', '  a [あ]', '  b [い]', '  c [う]', '}',
      'layout {',
      '  list @ (0, 0) 200x60',
      '  stack list (down; gap: 0; pad: 0; scroll) { a ; b ; c }',
      '}');
    expect(laid.boxes.has('a')).toBe(true);
    expect(laid.boxes.has('c')).toBe(false);
    expect(laid.diagnostics).toEqual([]);
  });

  it('scroll：バーのぶんだけ中身は狭くなる', () => {
    const wide = lay(
      'free {', '  list [ ]', '  a [あ]', '}',
      'layout {', '  list @ (0, 0) 200x200', '  stack list (down; pad: 0) { a }', '}');
    const cut = lay(
      'free {', '  list [ ]', '  a [あ]', '}',
      'layout {', '  list @ (0, 0) 200x200', '  stack list (down; pad: 0; scroll) { a }', '}');
    expect(wide.boxes.get('a').width - cut.boxes.get('a').width).toBe(12);
  });

  it('設定の綴りが違えば断る', () => {
    expect(() => parseDiagram('free {\n  f [ ]\n}\nlayout {\n  stack f (gpa: 4) { f }\n}'))
      .toThrow(DiagramParseError);
  });

  it('入れ物は 1 つのバイト範囲として読める', () => {
    const text = 'free {\n  f [ ]\n  a [あ]\n}\nlayout {\n  stack f (down) {\n    a\n  }\n}\n';
    const container = parseDiagram(text).containers.get('f')!;
    // バイト範囲なので、文字数ではなくバイトで切る（あ は 3 バイト）
    expect(sliceBytes(text, container.span.start, container.span.end))
      .toBe('stack f (down) {\n    a\n  }');
  });
});

describe('行を持つ部品', () => {
  const TREE = [
    'use "default"',
    '',
    'free {',
    '  nav tree: {',
    '    - マスタ管理',
    '      - 社員',
    '      - 部署 *',
    '    + 伝票',
    '  }',
    '}',
    '',
    'layout {',
    '  nav @ (0, 0) 200x240',
    '}',
    '',
  ].join('\n');

  it('行は図形ではない。深さと状態だけを持つ', () => {
    const nav = parseDiagram(TREE).nodes[0]!;
    expect(nav.items.map(one => [one.text, one.depth, one.closed, one.picked])).toEqual([
      ['マスタ管理', 0, false, false],
      ['社員', 1, false, false],
      ['部署', 1, false, true],
      ['伝票', 0, true, false],
    ]);
  });

  it('行に id は与えない——項目定義が要るのはツリー 1 つ', () => {
    const file = parseDiagram(TREE);
    expect(file.nodes.map(node => node.id)).toEqual(['nav']);
  });

  it('深さは字下げの入れ子で決まる（空白の数を決め打ちしない）', () => {
    const wide = parseDiagram(
      'free {\n  t list: {\n        - あ\n            - い\n        - う\n  }\n}\n');
    expect(wide.nodes[0]!.items.map(one => one.depth)).toEqual([0, 1, 0]);
  });

  it('図形の範囲は一覧ごと覆う', () => {
    const nav = parseDiagram(TREE).nodes[0]!;
    expect(sliceBytes(TREE, nav.span.start, nav.span.end).endsWith('}')).toBe(true);
    expect(sliceBytes(TREE, nav.span.start, nav.span.end)).toContain('伝票');
  });

  it('読めない行は断る', () => {
    expect(() => parseDiagram('free {\n  t list: {\n    あ\n  }\n}\n'))
      .toThrow(DiagramParseError);
  });

  it('一覧を持たない部品に書いた行は、黙って消えない', () => {
    const laid = layOutDiagram(withParts(parseDiagram(
      'use "default"\n\nfree {\n  box textbox: {\n    - あ\n  }\n}\n'
      + 'layout {\n  box @ (0,0)\n}\n'), () => undefined));
    expect(laid.diagnostics.join(' ')).toContain('この部品は一覧を持たない');
  });
});

describe('画面部品', () => {
  const LIBRARY = `parts {
  textbox   [ ] { fill: #fbfbfc, line: #aeb4bd, align: left } 320x34
  label     "" { color: #3a4048, align: left }                320x18
  primary   ( ) { fill: #2f6fb5, color: #ffffff }             320x38
  frame     [ ] { fill: #ffffff, line: #d3d7dd }
}
`;
  const read = (path: string): string | undefined =>
    (path === 'ui.dgm' ? LIBRARY : undefined);

  const screen = (body: string, layout = '', style = ''): string =>
    `use "ui.dgm"\n\nfree {\n${body}\n}\n\nlayout {\n${layout}\n}\n\nstyle {\n${style}\n}\n`;

  it('部品だけのファイルは、置くものを持たない', () => {
    const library = parseDiagram(LIBRARY);
    expect(library.mode).toBe('parts');
    expect([...library.parts.keys()]).toEqual(['textbox', 'label', 'primary', 'frame']);
    expect(library.nodes).toEqual([]);
  });

  it('図形と見た目と大きさを持つ', () => {
    const part = parseDiagram(LIBRARY).parts.get('textbox')!;
    expect(part.shape).toBe('rect');
    expect(Object.fromEntries(part.style)).toEqual({
      fill: '#fbfbfc', line: '#aeb4bd', align: 'left',
    });
    expect([part.width, part.height]).toEqual([320, 34]);
  });

  it('大きさは省ける', () => {
    expect(parseDiagram(LIBRARY).parts.get('frame')!.width).toBeUndefined();
  });

  it('部品の名前で図形を書くと、図形と見た目が付く', () => {
    const file = withParts(
      parseDiagram(screen('  idBox textbox:"山田"', '  idBox @ (70, 116)')), read);
    expect(file.nodes[0]!.shape).toBe('rect');
    expect(file.nodes[0]!.text).toBe('山田');
    expect(Object.fromEntries(file.style.get('idBox')!)).toEqual({
      fill: '#fbfbfc', line: '#aeb4bd', align: 'left',
    });
  });

  it('大きさは部品の既定を使う', () => {
    const file = withParts(
      parseDiagram(screen('  idBox textbox:"山田"', '  idBox @ (70, 116)')), read);
    expect(file.layout.get('idBox')).toMatchObject({ x: 70, y: 116, width: 320, height: 34 });
  });

  it('ピンが大きさを言えば、そちらが勝つ', () => {
    const file = withParts(
      parseDiagram(screen('  idBox textbox:"山田"', '  idBox @ (70, 116) 200x40')), read);
    expect(file.layout.get('idBox')).toMatchObject({ width: 200, height: 40 });
  });

  it('画面側の style は部品を上書きする', () => {
    const file = withParts(parseDiagram(
      screen('  idBox textbox:"山田"', '  idBox @ (70, 116)', '  idBox { fill: #fff0f0 }')), read);
    expect(Object.fromEntries(file.style.get('idBox')!)).toEqual({
      fill: '#fff0f0', line: '#aeb4bd', align: 'left',
    });
  });

  it('無い部品は黙って箱にせず、そう言う', () => {
    expect(() => withParts(parseDiagram(screen('  keep checkbox:')), read))
      .toThrow('部品が見つからない');
  });

  it('読めない部品ファイルもそう言う', () => {
    expect(() => withParts(parseDiagram(screen('  idBox textbox:')), () => undefined))
      .toThrow('部品の定義が読めない');
  });

  it('自分で宣言した部品が、取り込んだものに勝つ', () => {
    const source = `use "ui.dgm"\n\nparts {\n  textbox ( ) { fill: #000000 } 100x20\n}\n\n`
      + `free {\n  idBox textbox:"山田"\n}\n\nlayout {\n  idBox @ (0, 0)\n}\n`;
    const file = withParts(parseDiagram(source), read);
    expect(file.nodes[0]!.shape).toBe('round-rect');
    expect(file.layout.get('idBox')).toMatchObject({ width: 100, height: 20 });
  });

  it('部品を使わない図は、何も変わらない', () => {
    const plain = parseDiagram('free {\n  a [あ]\n}\n');
    expect(withParts(plain, read)).toBe(plain);
  });

  it('見本は、部品 1 つにつき 1 行で描ける', () => {
    const sheet = specimenOf(parseDiagram(LIBRARY));
    expect(sheet.mode).toBe('free');
    // 名前・書き方・見本・寸法の 4 つで 1 行
    expect(sheet.nodes.length).toBe(4 * 4);
    // 「どう書けばこれになるか」が読めること（指摘: 見た目の決まり方が分からない）
    expect(sheet.nodes.map(n => n.text)).toContain('[ ]');
    expect(sheet.nodes.map(n => n.text)).toContain('( )');
    expect(sheet.nodes.map(n => n.id)).toContain('textbox');
    expect(sheet.nodes.map(n => n.text)).toContain('textbox');
    expect(sheet.nodes.map(n => n.text)).toContain('320×34');
    expect(sheet.layout.get('textbox')).toMatchObject({ width: 320, height: 34 });
  });
});
