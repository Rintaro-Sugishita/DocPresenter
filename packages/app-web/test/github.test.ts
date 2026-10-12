// Reading addresses and refs the way GitHub does, against a GitHub held in a map.

import { describe, expect, it } from 'vitest';
import { failure, GitHub, githubUrl, longestRef, parseAddress, ViewerError, type Fetch } from '../src/index.js';

/** A GitHub that answers from a table and counts what it was asked. */
function fakeGitHub(routes: Record<string, unknown>, raw: Record<string, string> = {}) {
  const asked: string[] = [];
  const fetch: Fetch = async url => {
    asked.push(url);
    if (url in raw) return new Response(raw[url]);
    if (url in routes) return Response.json(routes[url]);
    return new Response('Not Found', { status: 404 });
  };
  return { github: new GitHub(fetch), asked };
}

const API = 'https://api.github.com/repos/o/r';
const SHA = 'a'.repeat(40);
const BRANCHES = [
  { name: 'main', commit: { sha: '1'.repeat(40) } },
  { name: 'claude/docpresenter-service-6rm7u3', commit: { sha: '2'.repeat(40) } },
  { name: 'claude', commit: { sha: '3'.repeat(40) } },
];
const TAGS = [{ name: 'v1.0', commit: { sha: '4'.repeat(40) } }];

describe('URL の切り分け', () => {
  it('ブラウザで見ている blob の URL', () => {
    expect(parseAddress('https://github.com/o/r/blob/main/docs/a.md')).toEqual({
      owner: 'o', repo: 'r', kind: 'blob', rest: ['main', 'docs', 'a.md'],
    });
  });

  it('raw の URL は blob として受ける（refs/heads/ も外す）', () => {
    expect(parseAddress('https://raw.githubusercontent.com/o/r/main/a.dgm')?.rest).toEqual(['main', 'a.dgm']);
    expect(parseAddress('https://raw.githubusercontent.com/o/r/refs/heads/feat/x/a.md')).toEqual({
      owner: 'o', repo: 'r', kind: 'blob', rest: ['feat', 'x', 'a.md'],
    });
  });

  it('tree の URL とリポジトリだけの URL はフォルダ', () => {
    expect(parseAddress('https://github.com/o/r/tree/main/docs')?.kind).toBe('tree');
    expect(parseAddress('https://github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r', kind: 'tree', rest: [] });
  });

  it('エンコードされたパスは戻し、問い合わせと断片は捨てる', () => {
    expect(parseAddress('https://github.com/o/r/blob/main/docs/%E8%A8%AD%E8%A8%88.md?plain=1#L3')?.rest)
      .toEqual(['main', 'docs', '設計.md']);
  });

  it('GitHub の文書でないものは受けない', () => {
    for (const text of [
      'not a url', 'https://example.com/o/r/blob/main/a.md', 'https://github.com/o',
      'https://github.com/o/r/issues/10', 'https://github.com/o/r/blob/main',
      'ftp://github.com/o/r/blob/main/a.md',
    ]) expect(parseAddress(text), text).toBeUndefined();
  });

  it('戻りの URL は区切りを保ったまま各段をエンコードする', () => {
    expect(githubUrl({ owner: 'o', repo: 'r', kind: 'blob', path: 'docs/設計 書.md' }, 'claude/x'))
      .toBe('https://github.com/o/r/blob/claude/x/docs/%E8%A8%AD%E8%A8%88%20%E6%9B%B8.md');
  });
});

describe('ref の解決', () => {
  it('存在する最長のブランチ名を採る（/ 入りのブランチ）', async () => {
    expect(longestRef('claude/docpresenter-service-6rm7u3/docs/a.md', BRANCHES.map(b => b.name)))
      .toBe('claude/docpresenter-service-6rm7u3');
    const { github } = fakeGitHub({
      [`${API}/branches?per_page=100`]: BRANCHES, [`${API}/tags?per_page=100`]: TAGS,
    });
    const at = await github.resolve(parseAddress('https://github.com/o/r/blob/claude/docpresenter-service-6rm7u3/docs/a.md')!);
    expect(at).toMatchObject({ ref: 'claude/docpresenter-service-6rm7u3', sha: '2'.repeat(40), path: 'docs/a.md' });
  });

  it('タグも ref になる', async () => {
    const { github } = fakeGitHub({
      [`${API}/branches?per_page=100`]: BRANCHES, [`${API}/tags?per_page=100`]: TAGS,
    });
    const at = await github.resolve(parseAddress('https://github.com/o/r/tree/v1.0/docs')!);
    expect(at).toMatchObject({ ref: 'v1.0', sha: '4'.repeat(40), path: 'docs', kind: 'tree' });
  });

  it('40 桁の SHA は API を呼ばずにそのまま使う', async () => {
    const { github, asked } = fakeGitHub({});
    const at = await github.resolve(parseAddress(`https://github.com/o/r/blob/${SHA}/a.md`)!);
    expect(at).toMatchObject({ ref: SHA, sha: SHA, path: 'a.md' });
    expect(asked).toEqual([]);
  });

  it('リポジトリだけなら既定ブランチ', async () => {
    const { github } = fakeGitHub({
      [API]: { default_branch: 'claude/x' },
      [`${API}/commits/claude/x`]: { sha: SHA },
    });
    expect(await github.resolve(parseAddress('https://github.com/o/r')!))
      .toMatchObject({ ref: 'claude/x', sha: SHA, path: '', kind: 'tree' });
  });

  it('一覧に無ければ前から順に commits に尋ねる（ブランチが 100 を超えるとき）', async () => {
    const { github } = fakeGitHub({
      [`${API}/branches?per_page=100`]: [], [`${API}/tags?per_page=100`]: [],
      [`${API}/commits/feat/many`]: { sha: SHA },
    });
    expect(await github.resolve(parseAddress('https://github.com/o/r/blob/feat/many/a.md')!))
      .toMatchObject({ ref: 'feat/many', sha: SHA, path: 'a.md' });
  });

  it('どれでもなければそう言う', async () => {
    const { github } = fakeGitHub({ [`${API}/branches?per_page=100`]: [], [`${API}/tags?per_page=100`]: [] });
    await expect(github.resolve(parseAddress('https://github.com/o/r/blob/nope/a.md')!))
      .rejects.toMatchObject({ id: 'web.error.ref' });
  });

  it('公開されていないリポジトリは 404 として言う', async () => {
    const { github } = fakeGitHub({});
    await expect(github.resolve(parseAddress('https://github.com/o/r/blob/main/a.md')!))
      .rejects.toMatchObject({ id: 'web.error.notFound', params: { what: 'o/r' } });
  });

  it('同じ問い合わせは二度しない（言語の切り替えで回数制限を使わない）', async () => {
    const { github, asked } = fakeGitHub({
      [`${API}/branches?per_page=100`]: BRANCHES, [`${API}/tags?per_page=100`]: TAGS,
    });
    const address = parseAddress('https://github.com/o/r/blob/main/a.md')!;
    await github.resolve(address);
    await github.resolve(address);
    expect(asked).toHaveLength(2);
  });
});

describe('ファイルの取得', () => {
  const location = { owner: 'o', repo: 'r', kind: 'blob' as const, ref: 'main', sha: SHA, path: 'a.md' };

  it('一覧は blob だけ、切り詰めも伝える', async () => {
    const { github } = fakeGitHub({
      [`${API}/git/trees/${SHA}?recursive=1`]: {
        tree: [{ path: 'docs', type: 'tree' }, { path: 'docs/a.md', type: 'blob' }], truncated: true,
      },
    });
    expect(await github.files(location)).toEqual({ paths: ['docs/a.md'], truncated: true });
  });

  it('中身は raw からコミット固定で取る。画像は data: URL', async () => {
    const { github, asked } = fakeGitHub({}, {
      [`https://raw.githubusercontent.com/o/r/${SHA}/docs/%E5%9B%B3.md`]: '# 図',
      [`https://raw.githubusercontent.com/o/r/${SHA}/p.svg`]: '<svg/>',
    });
    expect(await github.text(location, 'docs/図.md')).toBe('# 図');
    expect(await github.image(location, 'p.svg')).toBe(`data:image/svg+xml;base64,${btoa('<svg/>')}`);
    expect(await github.text(location, 'missing.md')).toBeUndefined();
    expect(asked.every(url => url.startsWith(`https://raw.githubusercontent.com/o/r/${SHA}/`))).toBe(true);
  });
});

describe('失敗の言い方', () => {
  it('回数制限は解除の時刻を添える', () => {
    const error = failure(new Response('', {
      status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' },
    }), 'u', 'o/r');
    expect(error).toBeInstanceOf(ViewerError);
    expect(error.id).toBe('web.error.rateLimit');
    expect(error.params['time']).toBe(new Date(1_700_000_000_000).toLocaleTimeString());
  });

  it('制限でない 403 は状態を添えて言う', () => {
    expect(failure(new Response('', { status: 403 }), 'u', 'o/r'))
      .toMatchObject({ id: 'web.error.http', params: { status: '403', url: 'u' } });
  });

  it('接続できなければそう言う', async () => {
    const github = new GitHub(async () => { throw new TypeError('Failed to fetch'); });
    await expect(github.resolve(parseAddress('https://github.com/o/r')!))
      .rejects.toMatchObject({ id: 'web.error.network', params: { message: 'Failed to fetch' } });
  });
});
