// docpresenter over folders made for each test. PDF and PNG need a browser,
// so these stay with what does not: HTML, the choice of files, the refusals.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMessages } from '@docpresenter/base';
import { DOC_MESSAGES, runDocpresenter } from '../src/index.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docpresenter-cli-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

function give(files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

/** Every file under out/, from the root. */
function written(): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(dir, path).split('\\').join('/'));
    }
  };
  walk(join(dir, 'out'));
  return found.sort();
}

async function run(...argv: string[]): Promise<{ code: number; said: string }> {
  const said: string[] = [];
  vi.spyOn(console, 'log').mockImplementation(line => { said.push(String(line)); });
  vi.spyOn(console, 'error').mockImplementation(line => { said.push(String(line)); });
  const code = await runDocpresenter([...argv, '--root', dir, '--lang', 'ja'], import.meta.url);
  vi.restoreAllMocks();
  return { code, said: said.join('\n') };
}

let numbered = 0;
const doc = (formats: string) =>
  `---\ndocument: SD-T-${String(++numbered).padStart(3, '0')}\ntitle: 試し\noutput: [${formats}]\n---\n\n# 試し\n\n本文。\n`;
const FLOW = 'flow {\n  a [A]\n  b [B]\n  a --> b\n}\n';

describe('export', () => {
  it('何も指定しなければ、output: を持つ文書だけを out/build/ にフォルダ構成のまま書く', async () => {
    give({
      'docs/order/design.md': doc('html'),
      'docs/order/revision.md': '# 改訂履歴\n',   // 部品。成果物にしない
      'docs/order/flow.dgm': FLOW,                 // 文書に入る図。単独では書かない
    });
    const { code } = await run('export');
    expect(code).toBe(0);
    expect(written()).toEqual(['out/build/docs/order/design.html']);
  });

  it('--to で形式を変え、直に指した部品の文書も書ける。--out と --flat も効く', async () => {
    give({ 'docs/a.md': doc('pdf'), 'docs/a/revision.md': '# 改訂履歴\n', 'docs/a/flow.dgm': FLOW });
    const { code } = await run('export', join(dir, 'docs/a.md'), join(dir, 'docs/a/revision.md'),
      join(dir, 'docs/a/flow.dgm'), '--to', 'html,svg', '--out', join(dir, 'out/flat'), '--flat');
    expect(code).toBe(0);
    expect(written()).toEqual(['out/flat/a.html', 'out/flat/flow.svg', 'out/flat/revision.html']);
  });

  it('フォルダに --to svg なら、図だけを書く', async () => {
    give({ 'docs/a.md': doc('html'), 'docs/a/flow.dgm': FLOW });
    expect((await run('export', '--to', 'svg')).code).toBe(0);
    expect(written()).toEqual(['out/build/docs/a/flow.svg']);
  });

  it('output: の無い文書を --to なしで指すと、使い方の誤り', async () => {
    give({ 'docs/a.md': '# a\n' });
    const { code, said } = await run('export', join(dir, 'docs/a.md'));
    expect(code).toBe(2);
    expect(said).toContain('output: が無いので');
  });

  it('文書に図の形式だけを頼むと誤り', async () => {
    give({ 'docs/a.md': doc('html') });
    expect((await run('export', join(dir, 'docs/a.md'), '--to', 'png')).code).toBe(2);
  });

  it('--flat で同じ名前になる文書があれば、何も書かずに止める', async () => {
    give({ 'docs/order/design.md': doc('html'), 'docs/billing/design.md': doc('html') });
    const { code, said } = await run('export', '--flat');
    expect(code).toBe(2);
    expect(said).toContain('どちらも');
    expect(written()).toEqual([]);
  });

  it('扱えないファイルを指すと誤り', async () => {
    give({ 'data.csv': 'a,b\n' });
    expect((await run('export', join(dir, 'data.csv'))).code).toBe(2);
  });
});

describe('check', () => {
  it('作業場全体を読み、指定したファイルの指摘だけを言う', async () => {
    give({
      'docs/a.md': doc('html') + '\n@import "missing.dgm"\n',
      'docs/b.dgm': 'flow {\n  a [A\n}\n',
    });
    const all = await run('check');
    expect(all.code).toBe(1);
    expect(all.said).toMatch(/docs\/a\.md:\d+(:\d+)?: エラー/);
    expect(all.said).toMatch(/docs\/b\.dgm:\d+(:\d+)?: エラー/);

    const one = await run('check', join(dir, 'docs/b.dgm'));
    expect(one.said).not.toContain('docs/a.md');
    expect(one.said).toContain('docs/b.dgm');
  });

  it('問題が無ければ終了コード 0、--json は配列', async () => {
    give({ 'docs/a.md': doc('html') });
    const { code, said } = await run('check', '--json');
    expect(code).toBe(0);
    expect(JSON.parse(said)).toEqual([]);
  });
});

describe('import', () => {
  it('.pptx と .pdf のほかは取り込めない', async () => {
    give({ 'a.txt': '' });
    expect((await run('import', join(dir, 'a.txt'))).code).toBe(2);
    expect((await run('import')).code).toBe(2);
  });
});

describe('文言', () => {
  it('日本語と英語が揃っている', () => {
    expect(checkMessages(DOC_MESSAGES)).toEqual([]);
  });
});
