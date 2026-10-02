import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasError, parseDocument, resolveDocument } from '../src/index.js';

const resolve = (source: string) => resolveDocument(parseDocument(source));

describe('図表の採番', () => {
  it('文書ごとの通し番号で、章番号を含めない', () => {
    const r = resolve([
      '# 題名', '', '## 一章', '',
      '@import "a.dgm" {#fig-a}', '', '@import "b.table" {#tbl-b}', '',
      '## 二章', '',
      '@import "c.dgm" {#fig-c}', '', '@import "d.table" {#tbl-d}',
    ].join('\n'));
    expect(r.byLabel.get('fig-a')!.number).toBe('1');
    expect(r.byLabel.get('fig-c')!.number).toBe('2');   // 章をまたいでも通し
    expect(r.byLabel.get('tbl-b')!.number).toBe('1');   // 図と表は別の連番
    expect(r.byLabel.get('tbl-d')!.number).toBe('2');
  });

  it('ラベルが無くても採番される', () => {
    const r = resolve('# 題名\n\n@import "a.dgm"\n\n@import "b.dgm" {#fig-b}');
    expect(r.elements.filter(e => e.kind === 'figure').map(e => e.number)).toEqual(['1', '2']);
  });

  it('ラベルの種別が拡張子と食い違えば警告する', () => {
    const r = resolve('# 題名\n\n@import "a.dgm" {#tbl-wrong}');
    expect(r.diagnostics[0]!.severity).toBe('warning');
    expect(r.diagnostics[0]!.message).toContain('食い違う');
  });
});

describe('見出しの採番', () => {
  it('階層番号を振り、先頭の h1 は題名として採番しない', () => {
    const r = resolve([
      '# 認証機能 設計書', '', '## 概要', '', '## ログイン機能', '',
      '### 画面遷移', '', '### 画面項目', '', '## トークン管理',
    ].join('\n'));
    const sections = r.elements.filter(e => e.kind === 'section');
    expect(sections.map(s => `${s.number ?? '—'} ${s.caption}`)).toEqual([
      '— 認証機能 設計書',
      '1 概要',
      '2 ログイン機能',
      '2.1 画面遷移',
      '2.2 画面項目',
      '3 トークン管理',
    ]);
  });

  it('深い階層から戻ったとき下位の番号が振り直される', () => {
    const r = resolve('# T\n\n## 一\n\n### 一の一\n\n## 二\n\n### 二の一');
    const numbers = r.elements.filter(e => e.kind === 'section').map(s => s.number);
    expect(numbers).toEqual([undefined, '1', '1.1', '2', '2.1']);
  });
});

describe('参照の解決', () => {
  it('@fig-… を「図 N」に解決する', () => {
    const source = '# 題名\n\n@import "a.dgm" {#fig-a}\n\n遷移を @fig-a に示す。';
    const r = resolve(source);
    expect([...r.referenceText.values()]).toEqual(['図 1']);
  });

  it('節への参照は「N 節」になる', () => {
    const r = resolve('# 題名\n\n## 概要 {#sec-o}\n\n詳細は @sec-o を参照。');
    expect([...r.referenceText.values()]).toEqual(['1 節']);
  });

  it('解決できない参照はエラーにする', () => {
    const r = resolve('# 題名\n\n存在しない @fig-missing を参照。');
    expect(hasError(r)).toBe(true);
    expect(r.diagnostics[0]!.message).toContain('@fig-missing');
  });

  it('ラベルの重複はエラーにする', () => {
    const r = resolve('# 題名\n\n@import "a.dgm" {#fig-x}\n\n@import "b.dgm" {#fig-x}');
    expect(hasError(r)).toBe(true);
    expect(r.diagnostics[0]!.message).toContain('重複');
  });
});

describe('サンプルの実ファイル', () => {
  it('auth-design.md の採番と参照がすべて解決する', () => {
    const r = resolve(readFileSync('sample/docs/auth-design.md', 'utf8'));

    expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(hasError(r)).toBe(false);

    // 図と表はそれぞれ 1 から続き番号。画像も作図も部品の見本も同じ系列で数える。
    // 本数を書き写すと標本が育つたびに壊れるので、続いていることを見る。
    const series = (kind: string): string[] =>
      r.elements.filter(e => e.kind === kind).map(e => e.number!);
    const consecutive = (numbers: string[]): boolean =>
      numbers.every((value, i) => value === String(i + 1));
    expect(series('figure').length).toBeGreaterThanOrEqual(8);
    expect(consecutive(series('figure'))).toBe(true);
    expect(series('table').length).toBeGreaterThanOrEqual(3);
    expect(consecutive(series('table'))).toBe(true);

    // 企画時に手で「図 2」と書いていたものが、計算でも図 2 になる
    expect(r.byLabel.get('fig-login-flow')!.number).toBe('2');
    expect(r.byLabel.get('fig-login-flow')!.caption).toBe('ログイン画面遷移');

    // 本文中の参照がすべて置換文字列を持つ
    const references = [...r.referenceText.values()];
    expect(references).toContain('図 2');
    expect(references).toContain('表 1');
    expect(references.length).toBeGreaterThanOrEqual(8);
  });
});
