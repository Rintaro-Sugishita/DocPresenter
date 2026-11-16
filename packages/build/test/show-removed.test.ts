// What is gone, drawn struck through when the build is asked to.

import { describe, expect, it } from 'vitest';
import { build, type Workspace } from '../src/index.js';

const NL = String.fromCharCode(10);
const lines = (...rows: string[]): string => rows.join(NL) + NL;

const THEME = { 'themes/default/theme.css': 'body { color: #000 }' };
const DOC = (body: string): string => lines('---', 'title: T', 'output: [html]', '---', '', body);

const BEFORE: Record<string, string> = {
  'docs/a.md': DOC(lines('# 概要', '', '残る段落。', '', '消える段落。', '', '古い言い方の段落。', '',
    '@import "items.table" {#tbl-items caption="項目"}', '', '@import "flow.dgm" {#fig-flow caption="流れ"}')),
  'docs/items.table': lines('| 項目 | 型 | 備考 |', '|------|----|------|',
    '| ID | text | あ |', '| 旧欄 | int | い |', '| 名前 | text | う |'),
  'docs/flow.dgm': lines('free {', '  a [入力]', '  b [確認]', '  c [旧処理]', '  a -> b', '  b -> c', '}'),
  ...THEME,
};
const AFTER: Record<string, string> = {
  'docs/a.md': DOC(lines('# 概要', '', '残る段落。', '', '新しい言い方の段落。', '',
    '@import "items.table" {#tbl-items caption="項目"}', '', '@import "flow.dgm" {#fig-flow caption="流れ"}')),
  'docs/items.table': lines('| 項目 | 型   |', '|------|------|', '| ID | char |', '| 名前 | text |'),
  'docs/flow.dgm': lines('free {', '  a [入力]', '  b [確認]', '  a -> b', '}'),
  ...THEME,
};

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => Object.keys(files), read: path => files[path], dataUrl: () => undefined,
});

async function html(showRemoved?: 'none' | 'strike'): Promise<string> {
  const result = await build(workspace(AFTER), {
    diffFrom: { name: 'v1', read: path => BEFORE[path] },
    ...(showRemoved ? { showRemoved } : {}),
  });
  return result.artifacts[0]!.text!;
}

describe('消えたものを取り消し線で見せる', () => {
  it('頼まれなければ、消えたものは出ない（今までどおり）', async () => {
    const page = await html();
    expect(page).not.toContain('消える段落');
    expect(page).not.toContain('旧欄');
    expect(page).not.toContain('旧処理');
    expect(page).not.toContain('dp-diff-was');
  });

  it('本文の消えた段落と、書き換える前の段落が、元の位置に取り消しで出る', async () => {
    const page = await html('strike');
    const gone = page.indexOf('消える段落');
    const old = page.indexOf('古い言い方の段落');
    expect(gone).toBeGreaterThan(page.indexOf('残る段落'));
    expect(old).toBeGreaterThan(gone);
    expect(old).toBeLessThan(page.indexOf('新しい言い方の段落'));
    expect(page).toMatch(/<div class="dp-prose dp-diff-removed"><p>消える段落。<\/p>/);
    // 前付けの設定は本文ではないので出ない
    expect(page).not.toContain('output: [html]');
    // 凡例に「削除」が載る
    expect(page).toContain('dp-diff-key dp-diff-removed');
  });

  it('表は、消えた行を元の位置に、変わったセルは元の文字を、消えた列は表の下に出す', async () => {
    const page = await html('strike');
    expect(page).toMatch(/<tr class="dp-diff-removed"><td[^>]*><del>旧欄<\/del><\/td><td[^>]*><del>int<\/del><\/td><\/tr>/);
    expect(page.indexOf('旧欄')).toBeGreaterThan(page.indexOf('>ID<'));
    expect(page.indexOf('旧欄')).toBeLessThan(page.indexOf('名前'));
    expect(page).toContain('<del class="dp-diff-was">text</del> char');
    expect(page).toMatch(/削除した列：<\/span> <del class="dp-diff-removed">備考<\/del>/);
  });

  it('図は、消えた図形と線を図の下に名前で出す', async () => {
    const page = await html('strike');
    expect(page).toMatch(/図から削除：<\/span> <del class="dp-diff-removed">旧処理<\/del> <del class="dp-diff-removed">確認 → 旧処理<\/del>/);
  });
});
