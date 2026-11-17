// The dark screen made from light stylesheets.

import { describe, expect, it } from 'vitest';
import { darkColour, darkStyle, darkValue, isVscodeDark } from '../src/view/dark.js';

const lightness = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return (r! + g! + b!) / 3;
};

describe('darkColour', () => {
  it('白い紙は暗い灰色に、黒い文字は明るい灰色になる', () => {
    const paper = darkColour([1, 1, 1]);
    const ink = darkColour([0, 0, 0]);
    expect(Math.max(...paper)).toBeLessThan(0.2);
    expect(Math.min(...ink)).toBeGreaterThan(0.85);
    // 真っ黒・真っ白にはしない
    expect(Math.min(...paper)).toBeGreaterThan(0.05);
    expect(Math.max(...ink)).toBeLessThan(0.97);
  });

  it('色相は残る（青は青のまま明るくなる）', () => {
    const blue = darkValue('#1f5fa8');
    const [r, , b] = [1, 3, 5].map(i => parseInt(blue.slice(i, i + 2), 16));
    expect(b!).toBeGreaterThan(r!);
    expect(lightness(blue)).toBeGreaterThan(lightness('#1f5fa8'));
  });
});

describe('darkValue', () => {
  it('不透明な色だけを変える。透ける色（影・薄い塗り）はそのまま', () => {
    expect(darkValue('1px solid #fff')).not.toContain('#fff');
    expect(darkValue('0 2px 6px rgba(0,0,0,.25)')).toBe('0 2px 6px rgba(0,0,0,.25)');
    expect(darkValue('rgba(31, 95, 168, .10)')).toBe('rgba(31, 95, 168, .10)');
    expect(darkValue('#ffffff80')).toBe('#ffffff80');
    expect(darkValue('rgb(255, 255, 255)')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('文字列と url() の中は色として扱わない', () => {
    expect(darkValue('"#1 white"')).toBe('"#1 white"');
    expect(darkValue('url(#fff)')).toBe('url(#fff)');
  });

  it('var() の既定値も変える', () => {
    expect(darkValue('var(--dp-fill, #fff)')).toMatch(/^var\(--dp-fill, #[0-9a-f]{6}\)$/);
    expect(darkValue('var(--dp-fill, #fff)')).not.toContain('#fff)');
  });

  it('名前の色も変える', () => {
    expect(darkValue('white')).toMatch(/^#[0-9a-f]{6}$/);
    expect(darkValue('transparent')).toBe('transparent');
    expect(darkValue('currentColor')).toBe('currentColor');
  });
});

describe('darkStyle', () => {
  it('塗りに関わる宣言だけを html.dp-dark の下に写す', () => {
    const dark = darkStyle('.a { color: #1c1f24; margin: 1em; padding: 2px; }');
    expect(dark).toContain('html.dp-dark .a:not(.dp-print *)');
    expect(dark).toContain('color: #');
    expect(dark).not.toContain('margin');
    expect(dark).not.toContain('padding');
  });

  it('塗りの無い規則は出さない', () => {
    expect(darkStyle('.a { margin: 1em; }')).toBe('');
  });

  it('枠線は色が無くても写す（写した弱い規則に上書きされないように）', () => {
    const dark = darkStyle('.a { border: 1px solid #ccc; } .a.b { border-left-width: 3px; }');
    expect(dark).toContain('border-left-width: 3px');
  });

  it('疑似要素の前に条件を入れる', () => {
    const dark = darkStyle('.a + .b::after { background: #fff; }');
    expect(dark).toContain('html.dp-dark .a + .b:not(.dp-print *)::after');
  });

  it(':root の色の変数は、印刷用のページには明るい値で戻す', () => {
    const dark = darkStyle(':root { --fill: #eef0f3; --font: "Noto"; }');
    expect(dark).toMatch(/html\.dp-dark \{ --fill: #[0-9a-f]{6}; \}/);
    expect(dark).toContain('html.dp-dark .dp-print { --fill: #eef0f3; }');
    expect(dark).not.toContain('--font');
  });

  it('body の色も印刷用のページには戻す。body.x は戻さない', () => {
    const dark = darkStyle('body { color: #1c1f24; } body.x { background: #fff; }');
    expect(dark).toContain('html.dp-dark body { color: #');
    expect(dark).toContain('html.dp-dark .dp-print { color: #1c1f24; }');
    expect(dark).toContain('html.dp-dark body.x { background: #');
  });

  it('選択子の並びは 1 つずつ包む。:is() の中のカンマでは割らない', () => {
    const dark = darkStyle('.a, .b :is(.c, .d) { fill: #000; }');
    expect(dark).toContain('html.dp-dark .a:not(.dp-print *), html.dp-dark .b :is(.c, .d):not(.dp-print *)');
  });

  it('@media は中身を包み直し、印刷・フォント・キーフレームは捨てる', () => {
    const dark = darkStyle(`
      @media (max-width: 800px) { .a { color: #000; } }
      @media print { .b { color: #000; } }
      @font-face { font-family: X; src: url(x.otf); }
      @keyframes k { from { background: #fff; } }
      /* .c { color: #000; } */
      .d { content: "{"; color: #000; }
    `);
    expect(dark).toContain('@media (max-width: 800px) {');
    expect(dark).toContain('.a:not(.dp-print *)');
    expect(dark).not.toContain('.b');
    expect(dark).not.toContain('font-face');
    expect(dark).not.toContain('keyframes');
    expect(dark).not.toContain('.c');
    expect(dark).toContain('.d:not(.dp-print *)');
  });

  it('!important を保つ', () => {
    expect(darkStyle('.a { color: #fff !important; }')).toMatch(/color: #[0-9a-f]{6} !important/);
  });
});

describe('darkStyle（二重にしない）', () => {
  it('ダーク版をもう一度ダークにしない', () => {
    const once = darkStyle('body { color: #1c1f24; }');
    expect(darkStyle(once)).toBe('');
  });
});

describe('isVscodeDark', () => {
  const classes = (...names: string[]): DOMTokenList =>
    ({ contains: (name: string) => names.includes(name) }) as unknown as DOMTokenList;
  it('VS Code のテーマの種類から明暗を決める', () => {
    expect(isVscodeDark(classes('vscode-light'))).toBe(false);
    expect(isVscodeDark(classes('vscode-dark'))).toBe(true);
    expect(isVscodeDark(classes('vscode-high-contrast'))).toBe(true);
    expect(isVscodeDark(classes('vscode-high-contrast', 'vscode-high-contrast-light'))).toBe(false);
  });
});
