import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  layOutDiagram, parseDiagram, parseRuns, specimenOf, withParts, wrapRuns, wrapText,
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
