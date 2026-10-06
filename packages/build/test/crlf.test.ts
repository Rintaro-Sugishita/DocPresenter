// A workspace checked out with CRLF line endings (core.autocrlf on Windows).
//
// Every byte range an artifact carries is where a review comment will be
// anchored, and an anchor is a commit and a byte range (design/review-model.md
// §3). The same commit is LF on one machine and CRLF on another, so what is
// built must not depend on which.

import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { asLf, build, diffOf, writeBack, type Workspace } from '../src/index.js';

const crlf = (text: string): string => text.replace(/\r?\n/g, '\r\n');

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => Object.keys(files),
  read: path => files[path],
  dataUrl: () => undefined,
});

const LF: Record<string, string> = {
  'docs/a.md': [
    '---', 'title: 認証設計', 'output: [html]', '---', '',
    '# 認証設計 {#sec-auth}', '', '一行目の段落。', '二行目で @fig-login を見る。', '',
    '@import "login.dgm" {#fig-login}', '', '@import "terms.table"', '',
    '---', '', '## 二枚目', '', '本文。', '',
  ].join('\n'),
  'docs/login.dgm': [
    'flow {', '  a [ログイン]', '  b [ホーム]', '  a --> b', '}', '',
    'layout {', '  a @ (10, 20)', '  b @ (10, 120)', '}', '',
  ].join('\n'),
  'docs/terms.table': [
    '| 用語 | 説明 |', '| ---- | ---- |', '| トークン | 認可に用いる |', '| 会員 | 登録済みの利用者 |', '',
  ].join('\n'),
  'themes/default/theme.css': 'body { color: #000 }\n',
};
const CRLF = Object.fromEntries(Object.entries(LF).map(([path, text]) => [path, crlf(text)]));

describe('改行が違っても、同じものが建つ', () => {
  it('HTML は、ソースマップの範囲まで 1 バイトも違わない', async () => {
    const [lf, windows] = await Promise.all([build(workspace(LF)), build(workspace(CRLF))]);
    const html = lf.artifacts[0]!.text!;
    expect(html).toContain('data-span=');
    expect(windows.artifacts[0]!.text).toBe(html);
    expect(windows.diagnostics).toEqual(lf.diagnostics);
  });

  it('範囲は、LF で読んだ本文の上で測られている', async () => {
    const html = (await build(workspace(CRLF))).artifacts[0]!.text!;
    const source = LF['docs/a.md']!;
    const bytes = new TextEncoder().encode(source);
    const heading = /<h1[^>]*data-span="(\d+),(\d+)"/.exec(html)!;
    expect(new TextDecoder().decode(bytes.slice(Number(heading[1]), Number(heading[2]))))
      .toBe('# 認証設計 {#sec-auth}');
  });

  it('LF の版と CRLF の作業場を比べても、違いは無い', () => {
    const marks = diffOf({
      workspace: workspace(CRLF),
      previous: path => LF[path],
      files: ['docs/a.md', 'docs/login.dgm', 'docs/terms.table'],
      from: 'HEAD',
      root: 'docs/a.md',
    });
    expect(marks.ranges).toEqual([]);
  });

  it('LF にした作業場は、何度包んでも同じ', () => {
    const once = asLf(workspace(CRLF));
    expect(asLf(once)).toBe(once);
    expect(once.read('docs/login.dgm')).toBe(LF['docs/login.dgm']);
  });
});

describe('CRLF の図に、デッキから書き戻す', () => {
  it('書き換わるのは直した行だけで、改行は CRLF のまま', async () => {
    const files = {
      ...CRLF,
      'docs/a.md': crlf('---\ntitle: 図\noutput: [pptx]\n---\n\n# 図\n\n@import "login.dgm" {#fig-login}\n'),
    };
    const deck = (await build(workspace(files))).artifacts.find(one => one.path.endsWith('.pptx'))!;
    const parts = unzipSync(deck.bytes!);
    const name = Object.keys(parts).find(part => /^ppt\/slides\/slide\d+\.xml$/.test(part)
      && strFromU8(parts[part]!).includes('login.dgm'))!;
    parts[name] = strToU8(strFromU8(parts[name]!).replace('<a:t>ホーム</a:t>', '<a:t>トップ</a:t>'));

    const result = writeBack(zipSync(parts), workspace(files));
    const file = result.files.find(one => one.path === 'docs/login.dgm')!;
    expect(file.changes.length).toBe(1);
    expect(file.text).toBe(files['docs/login.dgm']!.replace('[ホーム]', '[トップ]'));
  });
});
