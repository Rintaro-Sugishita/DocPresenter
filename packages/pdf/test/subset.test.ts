// Cutting the font down.
//
// This is the piece with the failure mode that no ordinary test catches: a
// subset can extract perfectly and draw nothing, or draw perfectly and extract
// as gibberish. Both have happened here. So the checks below look at the
// outlines, and at the glyphs the text actually resolves to — not at whether a
// file came out.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { createSubsetter, drawsGlyphs, isCff, writePdf, type PagePlan } from '../src/index.js';

const wasm = readFileSync(
  createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'));
const subsetter = await createSubsetter(wasm);

const NOTO = 'prototype/pdf-text/NotoSerifCJKjp-Regular.otf';
const font = new Uint8Array(readFileSync(NOTO));
const TEXT = '認証機能 設計書 髙﨑 ABC 012';
const codePoints = new Set([...TEXT].map(character => character.codePointAt(0)!));

interface Glyph { readonly id: number; readonly path: { readonly commands: readonly unknown[] } }
interface Face {
  layout(text: string): { glyphs: readonly (Glyph & { codePoints: number[] })[] };
  glyphForCodePoint(codePoint: number): Glyph;
  hasGlyphForCodePoint(codePoint: number): boolean;
  readonly directory: { readonly tables: Readonly<Record<string, unknown>> };
}
const open = (bytes: Uint8Array): Face => fontkit.create(Buffer.from(bytes)) as unknown as Face;

describe('サブセット', () => {
  const subset = subsetter(font, codePoints);

  it('CFF のまま、桁違いに小さくなる', () => {
    expect(isCff(font)).toBe(true);
    expect(isCff(subset)).toBe(true);
    expect(font.byteLength).toBeGreaterThan(10 * 1024 * 1024);
    expect(subset.byteLength).toBeLessThan(100 * 1024);
  });

  it('入れた字は、輪郭を持っている', () => {
    // pdf-lib 内蔵のサブセッタはここで落ちる。字は引けるが輪郭が空になり、
    // テキストは取り出せるのに 1 字も描かれない PDF ができる。
    const face = open(subset);
    for (const character of TEXT.replace(/\s/g, '')) {
      const glyph = face.glyphForCodePoint(character.codePointAt(0)!);
      expect(glyph, character).toBeTruthy();
      expect(glyph.path.commands.length, character).toBeGreaterThan(0);
    }
  });

  it('入れていない字は入っていない', () => {
    expect(open(subset).hasGlyphForCodePoint('猫'.codePointAt(0)!)).toBe(false);
  });

  it('組版の表は落とす', () => {
    // 残すと、埋め込むときにもう一度シェーピングが走って字形が差し替わり、
    // その字形は文字コードに戻せない——数字が制御文字として取り出される。
    const tables = Object.keys(open(subset).directory.tables);
    expect(tables).toContain('CFF ');
    expect(tables).toContain('cmap');
    expect(tables).not.toContain('GSUB');
    expect(tables).not.toContain('GPOS');
  });

  it('文字から引いた字形と、組んだ結果の字形が一致する', () => {
    // 一致していないと、埋め込み側が作る ToUnicode がその字形を含まず、
    // 取り出したときに文字コードではなく字形番号が出てくる。
    const face = open(subset);
    for (const glyph of face.layout('ABC 012').glyphs) {
      if (glyph.codePoints.length !== 1) continue;
      expect(face.glyphForCodePoint(glyph.codePoints[0]!).id).toBe(glyph.id);
    }
  });

  it('面の番号で、まとめられたフォントから 1 つを選べる', () => {
    // Noto CJK は日本語・韓国語・中国語 2 種を 1 ファイルに持つ。
    const collection = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(collection));
    } catch {
      return;                                   // 環境に無ければこの項は飛ばす
    }
    const jp = subsetter(bytes, codePoints, 0);
    const mono = subsetter(bytes, codePoints, 5);
    expect(jp.byteLength).toBeGreaterThan(0);
    expect(mono.byteLength).toBeGreaterThan(0);
    expect(jp).not.toEqual(mono);
  });

  it('削った結果に字形が入っているかを見分ける', () => {
    expect(drawsGlyphs(subset, codePoints)).toBe(true);

    // HarfBuzz は、頼みすぎると黙って輪郭の無いフォントを返す。形は揃って
    // いて、cmap も答える。埋めれば「取り出せるが白紙」の PDF になる。
    const many = new Set<number>();
    for (let code = 0x4e00; many.size < 22000; code++) many.add(code);
    const tooMany = subsetter(font, many);
    expect(drawsGlyphs(tooMany, many)).toBe(false);
  });

  it('CFF フォントも、サブセッタを渡せば書ける', async () => {
    const plan: PagePlan = {
      width: 200, height: 100,
      pages: [{ items: [{
        kind: 'text', text: TEXT, x: 10, y: 40, size: 12,
        bold: false, italic: false, family: 'body', colour: '#1c1f24',
      }] }],
    };
    const source = { bytes: font, name: 'NotoSerifCJKjp' };
    const { bytes, missing } = await writePdf(plan, {
      fonts: {
        body: source, bodyBold: source, heading: source, headingBold: source, mono: source,
      },
      subset: subsetter,
    });
    expect(missing).toEqual([]);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(bytes.byteLength).toBeLessThan(200 * 1024);   // 埋め込んだのはサブセット
  });
});
