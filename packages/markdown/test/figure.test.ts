// Renaming a figure: the file, the caption and the label, rewritten where they
// are written and nowhere else.

import { describe, expect, it } from 'vitest';
import { applyEdit, describeError } from '@docpresenter/base';
import {
  FigureNameError, parseDocument, removeImportLine, renameFigure, retargetImports, setImportLabel, setImportPath,
  type FigureNames,
} from '../src/index.js';

const DOC = [
  '# 設計書',
  '',
  'ログインの流れを @fig-login に示す。',
  '',
  '@import "design/diagram-1.dgm" {#fig-login caption="ログイン" width="80%"}',
  '',
  '## 補足 {#sec-note}',
  '',
  '@fig-login のとおり、ロックは 5 回。',
  '',
  '@import "design/diagram-1.dgm"',
  '',
  '@import "design/terms.table" {#tbl-terms}',
  '',
].join('\n');

/** The document after renaming the first figure. */
function renamed(names: FigureNames, source = DOC): string {
  const first = parseDocument(source).blocks.find(block => block.kind === 'import')!;
  const change = renameFigure(source, first.span, names);
  return change ? applyEdit(source, { ...change, description: '' }) : source;
}

describe('取り込み行の書き換え', () => {
  it('ラベルを付け替え、外し、足す。ほかの属性はそのまま', () => {
    expect(setImportLabel('@import "a.dgm" {#fig-a caption="A"}', 'fig-b')).toBe('@import "a.dgm" {#fig-b caption="A"}');
    expect(setImportLabel('@import "a.dgm" {#fig-a caption="A"}', undefined)).toBe('@import "a.dgm" {caption="A"}');
    expect(setImportLabel('@import "a.dgm" {#fig-a}', undefined)).toBe('@import "a.dgm"');
    expect(setImportLabel('@import "a.dgm"', 'fig-a')).toBe('@import "a.dgm" {#fig-a}');
  });

  it('パスを変えても属性は残る。画像の書き方も同じ', () => {
    expect(setImportPath('@import "a.dgm" {#fig-a}', 'b.dgm')).toBe('@import "b.dgm" {#fig-a}');
    expect(setImportPath('![画面](a.png) {width="50%"}', 'b.png')).toBe('![画面](b.png) {width="50%"}');
  });
});

describe('図の名前を変える', () => {
  it('ラベルを変えると、本文の参照も同じ名前になる', () => {
    const text = renamed({ label: 'fig-login-flow' });
    expect(text).toContain('@import "design/diagram-1.dgm" {#fig-login-flow caption="ログイン" width="80%"}');
    expect(text).toContain('ログインの流れを @fig-login-flow に示す。');
    expect(text).toContain('@fig-login-flow のとおり');
    expect(text).not.toMatch(/@fig-login\b(?!-)/);
  });

  it('変えたのは名前の書かれた行だけ', () => {
    const before = DOC.split('\n');
    const after = renamed({ label: 'fig-flow' }).split('\n');
    const changed = before.map((line, i) => line === after[i] ? -1 : i).filter(i => i >= 0);
    expect(changed).toEqual([2, 4, 8]);
  });

  it('題を変える・外す', () => {
    expect(renamed({ caption: 'ログインの流れ' })).toContain('{#fig-login caption="ログインの流れ" width="80%"}');
    expect(renamed({ caption: '' })).toContain('{#fig-login width="80%"}');
  });

  it('ファイル名を変えると、同じファイルを取り込むすべての行が新しいパスになる', () => {
    const text = renamed({ path: 'design/login-flow.dgm' });
    expect(text).toContain('@import "design/login-flow.dgm" {#fig-login caption="ログイン" width="80%"}');
    expect(text).toContain('\n@import "design/login-flow.dgm"\n');
    expect(text).not.toContain('diagram-1.dgm');
    expect(text).toContain('@import "design/terms.table" {#tbl-terms}');
  });

  it('3 つを一度に変えられる', () => {
    const text = renamed({ path: 'design/login-flow.dgm', caption: 'ログインの流れ', label: 'fig-flow' });
    expect(text).toContain('@import "design/login-flow.dgm" {#fig-flow caption="ログインの流れ" width="80%"}');
    expect(text).toContain('@fig-flow のとおり');
  });

  it('何も変えなければ何も書かない', () => {
    const first = parseDocument(DOC).blocks.find(block => block.kind === 'import')!;
    expect(renameFigure(DOC, first.span, { label: 'fig-login', caption: 'ログイン' })).toBeUndefined();
  });

  it('使えないラベルは理由を言って断る', () => {
    const refuse = (names: FigureNames): string => {
      try { renamed(names); return ''; } catch (error) {
        expect(error).toBeInstanceOf(FigureNameError);
        return describeError(error, 'ja');
      }
    };
    expect(refuse({ label: 'login' })).toContain('使えない');
    expect(refuse({ label: 'tbl-login' })).toContain('fig-');
    expect(refuse({ label: 'tbl-terms' })).toContain('fig-');
    expect(refuse({ label: 'sec-note' })).toContain('fig-');
    expect(refuse({ label: '' })).toContain('2 か所');
  });

  it('同じ文書の別のラベルとは重ならない', () => {
    const source = DOC.replace('{#tbl-terms}', '{#tbl-terms}\n\n@import "x.dgm" {#fig-other}');
    expect(() => renamed({ label: 'fig-other' }, source)).toThrow(FigureNameError);
  });
});

describe('ほかの文書の取り込み行', () => {
  it('動かしたファイルを指す行だけを、その文書からの相対で書き直す', () => {
    const source = '# 概要\n\n@import "../shared/arch.dgm" {#fig-arch}\n\n@import "../shared/terms.table"\n';
    const [one, ...rest] = retargetImports(source, 'docs/overview.md', 'shared/arch.dgm', 'shared/system.dgm');
    expect(rest).toEqual([]);
    expect(one!.text).toBe('@import "../shared/system.dgm" {#fig-arch}');
  });

  it('同じフォルダの中なら ../ を付けない', () => {
    const [one] = retargetImports('@import "a/x.dgm"\n', 'docs/d.md', 'docs/a/x.dgm', 'docs/a/y.dgm');
    expect(one!.text).toBe('@import "a/y.dgm"');
  });
});

describe('図を文書から外す', () => {
  const at = (text: string, line: string) => {
    const start = Buffer.from(text.slice(0, text.indexOf(line))).length;
    return { start, end: start + Buffer.from(line).length };
  };
  const out = (text: string, line: string): string =>
    applyEdit(text, { ...removeImportLine(text, at(text, line)), description: '' });

  it('取り込み行と、その後ろの空行 1 つが消え、前後の段落は空行 1 つで並ぶ', () => {
    const text = '前の段落。\n\n@import "a.dgm" {#fig-a}\n\n後の段落。\n';
    expect(out(text, '@import "a.dgm" {#fig-a}')).toBe('前の段落。\n\n後の段落。\n');
  });

  it('文書の最後なら、前の空行が消える', () => {
    const text = '前の段落。\n\n@import "a.dgm"\n';
    expect(out(text, '@import "a.dgm"')).toBe('前の段落。\n');
  });
});
