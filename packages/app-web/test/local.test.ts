// A folder handed over by the reader, held in memory: what is read, what is
// left out, and what `.git` says about the commit.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compose, gather, headOf, heldWorkspace, nodeOfEntry, nodeOfHandle, readFolder, type FolderNode,
} from '../src/index.js';

type Tree = { readonly [name: string]: string | Tree };

/** A folder from a plain object, counting what was opened. */
function folder(name: string, tree: Tree, opened: string[] = []): FolderNode {
  return {
    name,
    kind: 'directory',
    async children() {
      opened.push(name);
      return Object.entries(tree).map(([child, value]) => (typeof value === 'string'
        ? { name: child, kind: 'file' as const, children: async () => [], file: async () => new Blob([value]) }
        : folder(child, value, opened)));
    },
    file: () => Promise.reject(new Error('folder')),
  };
}

/** A folder on disk, as the browser would hand it over. */
function onDisk(path: string): FolderNode {
  const directory = statSync(path).isDirectory();
  return {
    name: basename(path),
    kind: directory ? 'directory' : 'file',
    children: async () => (directory ? readdirSync(path).map(child => onDisk(join(path, child))) : []),
    file: async () => new Blob([readFileSync(path)]),
  };
}

const SHA = 'b'.repeat(40);
const THEME = readFileSync(join(import.meta.dirname, '../../../themes/default/theme.css'), 'utf8');

describe('フォルダを読む', () => {
  it('ファイルの一覧を取り、.git と node_modules の中には入らない', async () => {
    const opened: string[] = [];
    const read = await readFolder(folder('repo', {
      'README.md': '# R',
      docs: { 'a.md': '# A', sub: { 'b.dgm': 'free {}' } },
      node_modules: { x: { 'y.md': 'no' } },
      '.git': { HEAD: 'ref: refs/heads/main\n', refs: { heads: { main: `${SHA}\n` } } },
    }, opened));
    expect(read.name).toBe('repo');
    expect(read.paths).toEqual(['README.md', 'docs/a.md', 'docs/sub/b.dgm']);
    expect(opened).not.toContain('node_modules');
    expect(read.truncated).toBe(false);
    expect(await read.text('docs/sub/b.dgm')).toBe('free {}');
    expect(await read.text('docs/none.md')).toBeUndefined();
  });

  it('画像は data: URL で', async () => {
    const read = await readFolder(folder('repo', { 'p.svg': '<svg/>' }));
    expect(await read.image('p.svg')).toBe(`data:image/svg+xml;base64,${btoa('<svg/>')}`);
  });

  it('多すぎれば途中で止めて、そう返す', async () => {
    const tree: Record<string, string> = {};
    for (let i = 0; i < 10; i++) tree[`${i}.md`] = '#';
    const counted: number[] = [];
    const read = await readFolder(folder('big', tree), count => counted.push(count), 4);
    expect(read.paths).toHaveLength(4);
    expect(read.truncated).toBe(true);
    expect(counted.at(-1)).toBe(4);
  });

  it('標本のフォルダを渡すと、取り込みを含めて組版できる', async () => {
    const sample = await readFolder(onDisk(join(import.meta.dirname, '../../../sample')));
    const options = { locale: 'ja' as const, shippedTheme: THEME };
    const { held } = await gather(sample, workspace => { compose(workspace, 'docs/auth-design.md', options); });
    const composed = compose(heldWorkspace(sample, held), 'docs/auth-design.md', options);
    expect(composed.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(composed.body).toContain('認証まわりのシステム構成');
  });
});

describe('.git からコミットを読む', () => {
  it('ブランチの ref ファイル（/ 入りのブランチも）', async () => {
    expect(await headOf(folder('.git', {
      HEAD: 'ref: refs/heads/claude/x\n', refs: { heads: { claude: { x: `${SHA.toUpperCase()}\n` } } },
    }))).toEqual({ branch: 'claude/x', sha: SHA });
  });

  it('ref ファイルが無ければ packed-refs から', async () => {
    expect(await headOf(folder('.git', {
      HEAD: 'ref: refs/heads/main\n',
      'packed-refs': `# pack-refs with: peeled fully-peeled sorted\n${'c'.repeat(40)} refs/heads/mainline\n${SHA} refs/heads/main\n`,
    }))).toEqual({ branch: 'main', sha: SHA });
  });

  it('切り離された HEAD はコミットそのもの。分からなければ分からないと', async () => {
    expect(await headOf(folder('.git', { HEAD: `${SHA}\n` }))).toEqual({ sha: SHA });
    expect(await headOf(folder('.git', { HEAD: 'ref: refs/heads/new\n' }))).toEqual({ branch: 'new' });
    expect(await headOf(folder('.git', {}))).toEqual({});
  });

  it('フォルダを読むときに一緒に読む', async () => {
    const read = await readFolder(folder('repo', { '.git': { HEAD: `${SHA}\n` }, 'a.md': '#' }));
    expect(read.git).toEqual({ sha: SHA });
    expect((await readFolder(folder('repo', { 'a.md': '#' }))).git).toEqual({});
  });
});

describe('渡し方の 2 つの形', () => {
  it('フォルダを選ぶ画面の handle', async () => {
    const file = (name: string, text: string) => ({ kind: 'file' as const, name, getFile: async () => new File([text], name) });
    const directory = (name: string, children: unknown[]) => ({
      kind: 'directory' as const, name,
      async *values() { yield* children as never[]; },
    });
    const read = await readFolder(nodeOfHandle(directory('repo', [file('a.md', '# A'), directory('d', [file('b.md', '# B')])])));
    expect(read.paths).toEqual(['a.md', 'd/b.md']);
    expect(await read.text('d/b.md')).toBe('# B');
  });

  it('ドロップの entry は、空の束が来るまで読む', async () => {
    const file = (name: string, text: string) => ({
      name, isDirectory: false, file: (done: (f: File) => void) => done(new File([text], name)),
    });
    const directory = (name: string, batches: unknown[][]) => ({
      name, isDirectory: true,
      createReader: () => {
        let i = 0;
        return { readEntries: (done: (entries: never[]) => void) => done((batches[i++] ?? []) as never[]) };
      },
    });
    const read = await readFolder(nodeOfEntry(directory('repo', [
      [file('a.md', '# A')], [directory('d', [[file('b.md', '# B')]])],
    ])));
    expect(read.paths).toEqual(['a.md', 'd/b.md']);
    expect(await read.text('a.md')).toBe('# A');
  });
});
