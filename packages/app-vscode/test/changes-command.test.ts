import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { atRevision, exportChanges, inFolder, versionsOf } from '../src/changes-command.js';
import { changesPath } from '../src/export-command.js';
import { give, held, picks, Uri, window } from './fake-vscode.js';

describe('変更箇所付きの書き出し', () => {
  it('比べる版の候補は、文書を変えたコミット → タグ → ほかのブランチの順', () => {
    const versions = versionsOf(
      'a1b2c3d\t2026-11-10\t認証の章を直す\ne4f5a6b\t2026-11-01\t初版\n',
      'v1.2\t2026-11-02\nv1.1\t2026-10-01\n',
      'main\t*\nrelease-1.2\t \n',
    );
    expect(versions.map(one => [one.kind, one.ref])).toEqual([
      ['commit', 'a1b2c3d'], ['commit', 'e4f5a6b'],
      ['tag', 'v1.2'], ['tag', 'v1.1'],
      // 今いるブランチは、比べても何も変わらないので出さない
      ['branch', 'release-1.2'],
    ]);
    expect(versions[0]!.detail).toContain('認証の章を直す');
  });

  it('印付きのファイルは、ふつうの書き出しの隣に置く（上書きしない）', () => {
    expect(changesPath('out/build/auth-design.pdf')).toBe('out/build/auth-design.changes.pdf');
    expect(changesPath('out/build/v1.0/auth-design.html')).toBe('out/build/v1.0/auth-design.changes.html');
    expect(changesPath('out/build/plain')).toBe('out/build/plain.changes');
  });

  const work = mkdtempSync(join(tmpdir(), 'dp-changes-'));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('コミットの時点のファイルを読む。無かったファイルは undefined', () => {
    const repo = join(work, 'repo');
    mkdirSync(join(repo, 'docs'), { recursive: true });
    const run = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    run('init', '-q');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'test');
    writeFileSync(join(repo, 'docs', 'a.md'), '前の版\n');
    run('add', '.');
    run('commit', '-q', '-m', 'first');
    run('tag', 'v1');
    writeFileSync(join(repo, 'docs', 'a.md'), '今の版\n');
    const read = atRevision(repo, 'v1');
    expect(read('docs/a.md')).toBe('前の版\n');
    expect(read('docs/missing.md')).toBeUndefined();
  });

  it('版と形式と消したところの見せ方を選ぶと、印付きの HTML を隣に書き出し、選んだものを覚える', async () => {
    // 作業場（/w）はリポジトリではないので、比べる相手はフォルダを選ぶ
    const before = join(work, 'received');
    mkdirSync(join(before, 'docs'), { recursive: true });
    writeFileSync(join(before, 'docs', 'a.md'), '---\ntitle: 設計\n---\n\n# 設計\n\n失敗が 3 回でロックする。\n\n消える段落。\n');
    give({
      'docs/a.md': '---\ntitle: 設計\noutput: [html]\n---\n\n# 設計\n\n失敗が 5 回でロックする。\n',
    });
    picks.dialog = [Uri.file(before)];
    const asked: string[][] = [];
    picks.quick = items => {
      const labels = items.map(one => String((one as { label?: string }).label));
      asked.push(labels);
      const wanted = labels.findIndex(label => label === 'HTML' || label.includes('取り消し線'));
      return wanted < 0 ? undefined : [items[wanted]!];
    };
    const memory = new Map<string, unknown>();
    const context = {
      extensionUri: Uri.file('/ext'),
      workspaceState: { get: (key: string) => memory.get(key), update: async (key: string, value: unknown) => { memory.set(key, value); } },
    } as unknown as vscode.ExtensionContext;
    const posted: unknown[] = [];
    const view = { documentPath: 'docs/a.md', post: (one: unknown) => posted.push(one), ask: async () => { throw new Error('no browser'); } };
    const output = window.createOutputChannel() as unknown as vscode.OutputChannel;

    await exportChanges(view as never, context, output);

    expect(asked).toHaveLength(2);
    const html = held.get('out/build/docs/a.changes.html');
    expect(html, [...held.keys()].join(', ')).toBeDefined();
    expect(held.has('out/build/docs/a.html')).toBe(false);
    expect(html).toContain('dp-diff-changed');
    // 凡例は比べた相手を名指しする
    expect(html).toContain(`${before} からの変更`);
    // 書き換える前の文と消えた段落は、取り消し線で今の文の前に残る
    expect(html).toMatch(/dp-diff-removed"><p>失敗が 3 回でロックする。<\/p>\s*<p>消える段落。<\/p>/);
    expect(html!.indexOf('消える段落')).toBeLessThan(html!.indexOf('失敗が 5 回'));
    expect(memory.get('docpresenter.changes')).toEqual({ from: before, format: 'html', showRemoved: 'strike' });
  });

  it('別のフォルダと比べるときは、そのフォルダを作業場の最上位として読む', () => {
    const before = join(work, 'before');
    mkdirSync(join(before, 'docs'), { recursive: true });
    writeFileSync(join(before, 'docs', 'a.md'), '受け取った版\n');
    const read = inFolder(before);
    expect(read('docs/a.md')).toBe('受け取った版\n');
    expect(read('docs/b.md')).toBeUndefined();
  });
});
