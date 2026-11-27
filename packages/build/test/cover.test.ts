import { describe, expect, it } from 'vitest';
import { build, settingsTemplate, SETTINGS_PATH, titlePage, type Workspace } from '../src/index.js';

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => Object.keys(files),
  read: path => files[path],
  dataUrl: () => undefined,
});
const THEME = { 'themes/default/theme.css': 'body { color: #000 }' };
const DOC = [
  '---', 'title: 基本設計書', 'document: F-001', 'version: "1.0"', 'author: 山田', 'reviewer: 鈴木', 'output: [html]', '---', '',
  '# 基本設計書', '', 'ログイン機能', '', '機能ID: F-001', '', '## はじめに', '', '本文。', '',
].join('\n');

const html = async (files: Record<string, string>): Promise<string> => {
  const result = await build(workspace({ 'a.md': DOC, ...THEME, ...files }));
  return result.artifacts.find(one => one.format === 'html')!.text!;
};

describe('表紙', () => {
  it('最初の ## より前が表紙になり、本文は ## から始まる', async () => {
    const page = await html({});
    const front = page.slice(page.indexOf('<section class="dp-front">'), page.indexOf('</section>', page.indexOf('<section class="dp-front">')));
    expect(front).toContain('<div class="dp-title-page">');
    expect(front).toContain('ログイン機能');
    expect(front).toContain('機能ID: F-001');
    // 表紙の題名は文書の # なので、front matter の題名を重ねて出さない
    expect(front).not.toContain('dp-cover-head');
    const body = page.slice(page.indexOf('<section class="dp-sheet"'));
    expect(body).not.toContain('ログイン機能');
    expect(body.indexOf('<h2')).toBeGreaterThan(-1);
    // 既定の欄
    expect(front).toContain('<dt>文書番号</dt><dd>F-001</dd>');
    expect(front).toContain('<dt>作成</dt><dd>山田</dd>');
  });

  it('リポジトリの設定で、出す欄・順・名前を決められ、空なら表を出さない', async () => {
    const page = await html({ [SETTINGS_PATH]: 'cover:\n  fields:\n    - reviewer: 承認\n    - version\n' });
    expect(page).toContain('<dt>承認</dt><dd>鈴木</dd>\n<dt>版</dt><dd>1.0</dd>');
    expect(page).not.toContain('<dt>文書番号</dt>');
    const none = await html({ [SETTINGS_PATH]: 'cover:\n  fields: []\n' });
    expect(none).not.toContain('dp-cover-fields');
    expect(none).toContain('dp-title-page');
  });

  it('初期化で書く設定は、既定と同じ欄を出す', async () => {
    const page = await html({ [SETTINGS_PATH]: settingsTemplate('ja') });
    expect(page).toContain('<dt>文書番号</dt><dd>F-001</dd>');
  });

  it('1 枚目が表紙だけなら、空のシートを残さない', () => {
    const body = '<section class="dp-sheet" data-sheet="1">\n<h1>題</h1>\n<p>機能名</p>\n</section>\n<section class="dp-sheet" data-sheet="2">\n<h2>章</h2>\n</section>\n';
    const split = titlePage(body)!;
    expect(split.title).toContain('機能名');
    expect(split.body).not.toContain('data-sheet="1"');
    expect(split.body).toContain('data-sheet="2"');
  });

  it('# で始まらない文書には表紙を作らない', () => {
    expect(titlePage('<section class="dp-sheet" data-sheet="1">\n<p>本文</p>\n</section>\n')).toBeUndefined();
  });
});
