import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { layOutDiagram, parseDiagram, wrapText } from '../src/index.js';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('作図ファイルの解析', () => {
  it('括弧の種類が図形になる', () => {
    const d = parseDiagram('flow {\n a ([丸])\n b [(筒)]\n c {菱}\n d ((円))\n e >付箋]\n f (角丸)\n g [四角]\n}');
    expect(d.nodes.map(n => n.shape)).toEqual(
      ['stadium', 'cylinder', 'diamond', 'ellipse', 'note', 'round-rect', 'rect']);
  });

  it('接続の線種と矢印を読み分ける', () => {
    const d = parseDiagram('flow {\n a [A]\n b [B]\n a --> b "ラベル"\n a -- b\n a -.-> b\n}');
    expect(d.edges).toEqual([
      { from: 'a', to: 'b', label: 'ラベル', line: 'solid', arrow: 'arrow' },
      { from: 'a', to: 'b', label: undefined, line: 'solid', arrow: 'none' },
      { from: 'a', to: 'b', label: undefined, line: 'dashed', arrow: 'arrow' },
    ]);
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
