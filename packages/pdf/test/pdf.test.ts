// The parts of the PDF path that do not need a browser: the geometry that
// travels between the two halves, and the font rule that exists because of a
// failure mode no test could otherwise see.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codePointsOf, isCff, mapPathData, tablesOf, writePdf, type PagePlan } from '../src/index.js';
import { colourOf } from '../src/collect.js';
import { toPoints } from '../src/measure.js';

const same = (x: number, y: number): { x: number; y: number } => ({ x, y });
const twice = (x: number, y: number): { x: number; y: number } => ({ x: x * 2, y: y * 2 });

describe('パスの写し取り', () => {
  it('座標を写す', () => {
    expect(mapPathData('M 10 20 L 30 40', twice, 2)).toBe('M 20 40 L 60 80');
  });

  it('円弧のフラグは数値ではない', () => {
    // 半径は倍に、フラグはそのまま、終点は写る。ここを一律に掛けると
    // sweep フラグが 0.75 になり、以降の直線が「消える」壊れ方をする。
    expect(mapPathData('M 0 12 A 40 12 0 0 1 80 12', twice, 2))
      .toBe('M 0 24 A 80 24 0 0 1 160 24');
  });

  it('相対コマンドは、いまの筆の位置から数える', () => {
    // 大文字に揃えて絶対として読むと、同梱の絵がことごとく長い斜線になる。
    expect(mapPathData('M 10 10 l 5 5 l 5 -5', same, 1)).toBe('M 10 10 L 15 15 L 20 10');
    expect(mapPathData('m 10 10 l 5 0', same, 1)).toBe('M 10 10 L 15 10');
  });

  it('水平・垂直は直線として写す', () => {
    // 読み飛ばすと線が消える。消えたことは誰にも分からない。
    expect(mapPathData('M 0 12 h 17', same, 1)).toBe('M 0 12 L 17 12');
    expect(mapPathData('M 0 12 v -4 H 20 V 0', same, 1))
      .toBe('M 0 12 L 0 8 L 20 8 L 20 0');
  });

  it('曲線も残る', () => {
    expect(mapPathData('M 0 0 C 1 2 3 4 5 6', same, 1)).toBe('M 0 0 C 1 2 3 4 5 6');
    expect(mapPathData('M 0 0 c 1 2 3 4 5 6', same, 1)).toBe('M 0 0 C 1 2 3 4 5 6');
  });

  it('続きの数値は、同じコマンドの繰り返しである', () => {
    expect(mapPathData('M 0 0 L 1 1 2 2', same, 1)).toBe('M 0 0 L 1 1 L 2 2');
    // M のあとに続く組は L として読む（SVG の規則）
    expect(mapPathData('M 0 0 1 1', same, 1)).toBe('M 0 0 L 1 1');
  });

  it('相対の円弧も終点だけが写る', () => {
    expect(mapPathData('M 10 10 a 4 4 0 0 1 8 0', twice, 2))
      .toBe('M 20 20 A 8 8 0 0 1 36 20');
  });

  it('閉じたあとは、始点から数え直す', () => {
    expect(mapPathData('M 10 10 L 20 10 Z l 5 5', same, 1))
      .toBe('M 10 10 L 20 10 Z L 15 15');
  });

  it('閉じるコマンドは残る', () => {
    expect(mapPathData('M 0 0 L 10 0 Z', same, 1)).toBe('M 0 0 L 10 0 Z');
  });

  it('続けて書かれた座標は直線として展開される', () => {
    expect(mapPathData('M 0 0 10 0 10 10', same, 1)).toBe('M 0 0 L 10 0 L 10 10');
  });
});

describe('色', () => {
  it('ブラウザの rgb() を 16 進に直す', () => {
    expect(colourOf('rgb(28, 31, 36)')).toBe('#1c1f24');
  });

  it('透明は色ではない', () => {
    expect(colourOf('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(colourOf('transparent')).toBeUndefined();
    expect(colourOf('none')).toBeUndefined();
  });
});

describe('寸法', () => {
  it('テーマの単位をポイントに直す', () => {
    expect(Math.round(toPoints('210mm'))).toBe(595);        // A4 の幅
    expect(Math.round(toPoints('297mm'))).toBe(842);
    expect(toPoints('12pt')).toBe(12);
    expect(toPoints('1in')).toBe(72);
    expect(toPoints('96px')).toBe(72);
  });

  it('読めない値は既定に落とす', () => {
    expect(toPoints('auto', 57)).toBe(57);
  });
});

describe('使う字', () => {
  it('計画に出てくる字を集める', () => {
    const plan: PagePlan = {
      width: 100, height: 100,
      pages: [{ items: [
        { kind: 'text', text: '認証', x: 0, y: 0, size: 10, bold: false, italic: false, family: 'body', colour: '#000' },
        { kind: 'fill', x: 0, y: 0, width: 1, height: 1, colour: '#000' },
      ] }],
    };
    expect([...codePointsOf(plan)].map(c => String.fromCodePoint(c)).join('')).toBe('認証');
  });
});

describe('フォント', () => {
  const noto = readFileSync('prototype/pdf-text/NotoSerifCJKjp-Regular.otf');

  it('CFF フォントを見分ける', () => {
    expect(tablesOf(noto)).toContain('CFF ');
    expect(isCff(noto)).toBe(true);
  });

  it('CFF フォントはサブセット化の手立てが無ければ断る', async () => {
    // pdf-lib のサブセッタは CFF を壊す。壊れ方が「文字は取り出せるが
    // 1 字も描かれない」なので、書いてしまうと検証は通り、PDF は白紙になる。
    const plan: PagePlan = {
      width: 100, height: 100,
      pages: [{ items: [
        { kind: 'text', text: '認証', x: 0, y: 0, size: 10, bold: false, italic: false, family: 'body', colour: '#000' },
      ] }],
    };
    const font = { bytes: noto, name: 'NotoSerifCJKjp' };
    await expect(writePdf(plan, { fonts: {
      body: font, bodyBold: font, heading: font, headingBold: font, mono: font,
    } })).rejects.toThrow(/CFF/);
  });
});
