// Gathering a document's files by rendering it, against the sample folder
// standing in for a repository.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Workspace } from '@docpresenter/build';
import { compose, gather, heldWorkspace, viewableUnder, viewingRoot, type FileSource } from '../src/index.js';

const SAMPLE = join(import.meta.dirname, '../../../sample');
const THEME = readFileSync(join(import.meta.dirname, '../../../themes/default/theme.css'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [relative(SAMPLE, join(dir, entry.name)).split('\\').join('/')]);
}
const PATHS = walk(SAMPLE);
const IMAGE = /\.(png|jpe?g|gif|svg)$/i;

/** The sample as a repository, counting what was fetched. */
function repository(): FileSource & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    paths: PATHS,
    fetched,
    async text(path) { fetched.push(path); return readFileSync(join(SAMPLE, path), 'utf8'); },
    async image(path) { fetched.push(path); return `data:image/png;base64,${readFileSync(join(SAMPLE, path)).toString('base64')}`; },
  };
}

/** The whole sample held at once: what a build on a checkout sees. */
const everything: Workspace = {
  list: () => PATHS,
  read: path => (PATHS.includes(path) && !IMAGE.test(path) ? readFileSync(join(SAMPLE, path), 'utf8') : undefined),
  dataUrl: path => (PATHS.includes(path) && IMAGE.test(path)
    ? `data:image/png;base64,${readFileSync(join(SAMPLE, path)).toString('base64')}` : undefined),
};

const options = { locale: 'ja' as const, shippedTheme: THEME };

describe('取り込みの閉包を集める', () => {
  it('集めたものだけで、全部あるときと同じ組版になる（../shared・画像・部品ライブラリを含む）', async () => {
    const source = repository();
    const { held, complete } = await gather(source, workspace => { compose(workspace, 'docs/auth-design.md', options); });
    expect(complete).toBe(true);
    const fromGathered = compose(heldWorkspace(source, held), 'docs/auth-design.md', options);
    const fromAll = compose(everything, 'docs/auth-design.md', options);
    expect(fromGathered.body).toBe(fromAll.body);
    expect(fromGathered.diagnostics).toEqual(fromAll.diagnostics);

    // 取りに行ったのは文書が指すものだけで、他の文書には手を出していない。
    expect(source.fetched).toContain('shared/system-architecture.dgm');
    expect(source.fetched.some(path => IMAGE.test(path))).toBe(true);
    expect(source.fetched).not.toContain('docs/order-slides.md');
    expect(new Set(source.fetched).size).toBe(source.fetched.length);
  });

  it('リポジトリに無いものは取りに行かず、ビルドの診断として出る', async () => {
    const source: FileSource = {
      paths: ['docs/a.md'],
      text: async () => '# A\n\n@import "gone.dgm" {#fig-x caption="x"}\n',
      image: async () => undefined,
    };
    const { held } = await gather(source, workspace => { compose(workspace, 'docs/a.md', options); });
    expect([...held.texts.keys()]).toEqual(['docs/a.md']);
    const composed = compose(heldWorkspace(source, held), 'docs/a.md', options);
    expect(composed.diagnostics.map(d => d.message).join('\n')).toContain('docs/gone.dgm');
  });

  it('多すぎれば途中で止めてそう返す', async () => {
    const source = repository();
    const { complete } = await gather(source, workspace => { compose(workspace, 'docs/auth-design.md', options); }, undefined, 3);
    expect(complete).toBe(false);
    expect(source.fetched.length).toBeLessThanOrEqual(3);
  });

  it('リポジトリにテーマがあればそれを使い、無ければ同梱のもの', () => {
    const files: Record<string, string> = {
      'a.md': '---\ntheme: corp\n---\n\n# A\n',
      '.docpresenter/themes/corp/theme.css': 'body { color: red }',
      'b.md': '# B\n',
    };
    const workspace: Workspace = { list: () => Object.keys(files), read: path => files[path] };
    expect(compose(workspace, 'a.md', options).style).toBe('body { color: red }');
    expect(compose(workspace, 'b.md', options).style).toBe(THEME);
  });
});

describe('.dgm 単体', () => {
  it('隣に 1 図だけの文書を組み立てて、図のパスはそのまま効く', () => {
    expect(viewingRoot('docs/x/login.dgm')).toEqual({
      root: 'docs/x/.docpresenter-view-login.dgm.md', source: '@import "login.dgm"\n',
    });
    expect(viewingRoot('top.dgm').root).toBe('.docpresenter-view-top.dgm.md');
    expect(viewingRoot('docs/a.md')).toEqual({ root: 'docs/a.md' });
  });

  it('部品ライブラリを使う図も描ける', async () => {
    const source = repository();
    const path = 'docs/auth-design/login-screen.dgm';
    const { held } = await gather(source, workspace => { compose(workspace, path, options); });
    const composed = compose(heldWorkspace(source, held), path, options);
    expect(composed.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(composed.body).toContain('<svg');
    expect(composed.title).toBe('login-screen.dgm');
    expect(source.fetched).toContain('shared/ui-parts.dgm');
  });

  it('図が読めないときの診断は図のパスで言う', () => {
    const files: Record<string, string> = { 'x.dgm': 'free {\n  a [A\n' };
    const workspace: Workspace = { list: () => Object.keys(files), read: path => files[path] };
    const composed = compose(workspace, 'x.dgm', options);
    expect(composed.diagnostics.every(d => !d.path.includes('.docpresenter-view'))).toBe(true);
  });
});

describe('フォルダの一覧', () => {
  it('フォルダの下の .md と .dgm を、道具の置き場を除いて並べる', () => {
    const paths = [
      'docs/b.md', 'docs/a.md', 'docs/sub/c.dgm', 'docs/x.table', 'docsx/no.md',
      'docs/.docpresenter/guide.md', 'docs/CLAUDE.md', 'README.md',
    ];
    expect(viewableUnder(paths, 'docs')).toEqual({ documents: ['docs/a.md', 'docs/b.md'], drawings: ['docs/sub/c.dgm'] });
    expect(viewableUnder(paths, '').documents).toContain('README.md');
  });
});
