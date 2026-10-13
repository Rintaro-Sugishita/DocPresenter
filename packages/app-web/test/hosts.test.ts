// Reading addresses, refs and files the way each host does, against hosts
// held in a table. The shapes of the answers were taken from the real hosts
// (github.com, gitlab.com, codeberg.org, dev.azure.com).

import { describe, expect, it } from 'vitest';
import {
  addressOf, failure, longestRef, Tokens, ViewerError, type Fetch, type Host, type TokenStorage,
} from '../src/index.js';

interface Asked { readonly url: string; readonly headers: Record<string, string>; readonly redirect?: string }

/** A host that answers from a table and records what it was asked. */
function fake(routes: Record<string, unknown>, files: Record<string, string> = {}) {
  const asked: Asked[] = [];
  const fetch: Fetch = async (url, init) => {
    asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, ...(init?.redirect ? { redirect: init.redirect } : {}) });
    if (url in files) return new Response(files[url]);
    if (url in routes) {
      const answer = routes[url];
      return answer instanceof Response ? answer : Response.json(answer);
    }
    return new Response('{"message":"Not Found"}', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, asked };
}

function open(address: string, fetch: Fetch, token?: string): Host {
  const addressed = addressOf(address);
  if (!addressed) throw new Error(`not an address: ${address}`);
  return addressed.open({ fetch, ...(token === undefined ? {} : { token }) });
}

const SHA = 'a'.repeat(40);
const S1 = '1'.repeat(40);
const S2 = '2'.repeat(40);

describe('どのホストかを URL から見分ける', () => {
  it.each([
    ['https://github.com/o/r/blob/main/docs/a.md', 'github', 'https://github.com'],
    ['https://raw.githubusercontent.com/o/r/main/a.dgm', 'github', 'https://github.com'],
    ['https://ghe.example.co.jp/o/r/tree/main/docs', 'github', 'https://ghe.example.co.jp'],
    ['https://gitlab.com/g/sub/p/-/blob/main/a.md', 'gitlab', 'https://gitlab.com'],
    ['https://gitlab.com/g/p', 'gitlab', 'https://gitlab.com'],
    ['https://git.example.local/g/p/-/tree/main', 'gitlab', 'https://git.example.local'],
    ['https://codeberg.org/o/r/src/branch/main/a.md', 'gitea', 'https://codeberg.org'],
    ['https://codeberg.org/o/r', 'gitea', 'https://codeberg.org'],
    ['https://dev.azure.com/org/proj/_git/repo?path=/a.md&version=GBmain', 'azure', 'https://dev.azure.com/org'],
    ['https://org.visualstudio.com/proj/_git/repo', 'azure', 'https://org.visualstudio.com'],
    ['https://tfs.example.local/DefaultCollection/proj/_git/repo', 'azure', 'https://tfs.example.local/DefaultCollection'],
    ['http://git.example.local/o/r/src/commit/' + SHA + '/a.md', 'gitea', 'http://git.example.local'],
  ])('%s は %s', (address, type, origin) => {
    const addressed = addressOf(address)!;
    expect(addressed.origin).toBe(origin);
    expect(addressed.open({ fetch: fake({}).fetch }).type).toBe(type);
  });

  it.each([
    'not a url', 'https://example.com/o/r/blob/main', 'https://github.com/o',
    'https://github.com/o/r/issues/10', 'https://git.example.local/o/r',
    'ftp://github.com/o/r/blob/main/a.md', 'https://user:pass@github.com/o/r/blob/main/a.md',
    'https://dev.azure.com/org/proj/_git/repo?version=XXmain',
  ])('%s は受けない', address => {
    expect(addressOf(address)).toBeUndefined();
  });

  it('エンコードされたパスは戻し、問い合わせと断片は捨てる', async () => {
    const { fetch } = fake({});
    const host = open(`https://github.com/o/r/blob/${SHA}/docs/%E8%A8%AD%E8%A8%88.md?plain=1#L3`, fetch);
    expect((await host.resolve()).path).toBe('docs/設計.md');
  });
});

describe('ref の切り分け', () => {
  it('存在する最長の名前を採る（/ 入りのブランチ）', () => {
    expect(longestRef('claude/x/docs/a.md', ['claude', 'claude/x', 'main'])).toBe('claude/x');
    expect(longestRef('mainline/a.md', ['main'])).toBeUndefined();
  });
});

describe('GitHub', () => {
  const API = 'https://api.github.com/repos/o/r';
  const refs = {
    [`${API}/branches?per_page=100`]: [{ name: 'main', commit: { sha: S1 } }, { name: 'claude/x', commit: { sha: S2 } }],
    [`${API}/tags?per_page=100`]: [{ name: 'v1.0', commit: { sha: SHA } }],
  };

  it('/ 入りのブランチもタグも、一覧から最長一致で', async () => {
    const { fetch } = fake(refs);
    expect(await open('https://github.com/o/r/blob/claude/x/docs/a.md', fetch).resolve())
      .toMatchObject({ ref: 'claude/x', sha: S2, path: 'docs/a.md', label: 'o/r', name: 'r' });
    expect(await open('https://github.com/o/r/tree/v1.0/docs', fetch).resolve())
      .toMatchObject({ ref: 'v1.0', sha: SHA, path: 'docs', kind: 'tree' });
  });

  it('40 桁の SHA は API を呼ばない', async () => {
    const { fetch, asked } = fake({});
    expect(await open(`https://github.com/o/r/blob/${SHA}/a.md`, fetch).resolve()).toMatchObject({ ref: SHA, sha: SHA });
    expect(asked).toEqual([]);
  });

  it('リポジトリだけなら既定ブランチ、一覧に無ければ commits に尋ねる', async () => {
    const { fetch } = fake({
      [API]: { default_branch: 'claude/x' }, [`${API}/commits/claude/x`]: { sha: S2 },
      [`${API}/branches?per_page=100`]: [], [`${API}/tags?per_page=100`]: [], [`${API}/commits/feat/many`]: { sha: S1 },
    });
    expect(await open('https://github.com/o/r', fetch).resolve()).toMatchObject({ ref: 'claude/x', sha: S2, path: '' });
    expect(await open('https://github.com/o/r/blob/feat/many/a.md', fetch).resolve()).toMatchObject({ ref: 'feat/many', path: 'a.md' });
    await expect(open('https://github.com/o/r/blob/nope/a.md', fetch).resolve()).rejects.toMatchObject({ id: 'web.error.ref' });
  });

  it('公開リポジトリの中身は raw から（トークンは無い）', async () => {
    const { fetch, asked } = fake({}, { [`https://raw.githubusercontent.com/o/r/${SHA}/docs/%E5%9B%B3.md`]: '# 図' });
    const host = open(`https://github.com/o/r/blob/${SHA}/x.md`, fetch);
    const at = await host.resolve();
    expect(await host.text(at, 'docs/図.md')).toBe('# 図');
    expect(asked[0]!.headers['Authorization']).toBeUndefined();
  });

  it('トークンがあれば中身は contents API から、トークンを付けて。raw ホストには送らない', async () => {
    const { fetch, asked } = fake({}, { [`${API}/contents/docs/a.md?ref=${SHA}`]: '# private' });
    const host = open(`https://github.com/o/r/blob/${SHA}/x.md`, fetch, 'ghp_x');
    const at = await host.resolve();
    expect(await host.text(at, 'docs/a.md')).toBe('# private');
    expect(asked.every(one => one.headers['Authorization'] === 'Bearer ghp_x')).toBe(true);
    expect(asked.some(one => one.url.includes('raw.githubusercontent.com'))).toBe(false);
    expect(asked[0]!.headers['Accept']).toBe('application/vnd.github.raw+json');
  });

  it('Enterprise は /api/v3 を、中身も API から', async () => {
    const { fetch, asked } = fake({
      [`https://ghe.local/api/v3/repos/o/r/git/trees/${SHA}?recursive=1`]: { tree: [{ path: 'a.md', type: 'blob' }] },
    }, { [`https://ghe.local/api/v3/repos/o/r/contents/a.md?ref=${SHA}`]: '# A' });
    const host = open(`https://ghe.local/o/r/blob/${SHA}/a.md`, fetch);
    const at = await host.resolve();
    expect(await host.files(at)).toEqual({ paths: ['a.md'], truncated: false });
    expect(await host.text(at, 'a.md')).toBe('# A');
    expect(host.name).toBe('ghe.local');
    expect(host.tokenHelp.url).toBe('https://ghe.local/settings/tokens');
    expect(asked.every(one => one.url.startsWith('https://ghe.local/'))).toBe(true);
  });

  it('非公開（404）はトークンを求め、トークンがあれば権限の話にする', async () => {
    const without = await open('https://github.com/o/r/blob/main/a.md', fake({}).fetch).resolve().catch(e => e);
    expect(without).toMatchObject({ id: 'web.error.notFound', params: { what: 'o/r' }, wantsToken: true });
    const withToken = await open('https://github.com/o/r/blob/main/a.md', fake({}).fetch, 't').resolve().catch(e => e);
    expect(withToken).toMatchObject({ id: 'web.error.notFoundToken', wantsToken: true });
  });

  it('同じ問い合わせは二度しない', async () => {
    const { fetch, asked } = fake(refs);
    const host = open('https://github.com/o/r/blob/main/a.md', fetch);
    await host.resolve();
    await host.resolve();
    expect(asked).toHaveLength(2);
  });

  it('戻りの URL は自分の解析で読み戻せる', async () => {
    const host = open(`https://github.com/o/r/blob/${SHA}/a.md`, fake({}).fetch);
    const back = host.webUrl({ kind: 'blob', path: 'docs/設計 書.md', sha: SHA });
    expect(back).toBe(`https://github.com/o/r/blob/${SHA}/docs/%E8%A8%AD%E8%A8%88%20%E6%9B%B8.md`);
    expect(await open(back, fake({}).fetch).resolve()).toMatchObject({ sha: SHA, path: 'docs/設計 書.md' });
  });
});

describe('GitLab', () => {
  const API = 'https://gitlab.com/api/v4/projects/g%2Fsub%2Fp';

  it('入れ子のグループと / 入りのブランチ。候補は先頭の名前で絞って取る', async () => {
    const { fetch, asked } = fake({
      [`${API}/repository/branches?per_page=100&search=%5Eclaude`]: [{ name: 'claude/x', commit: { id: S2 } }],
      [`${API}/repository/tags?per_page=100&search=%5Eclaude`]: [],
    });
    const at = await open('https://gitlab.com/g/sub/p/-/blob/claude/x/docs/a.md', fetch).resolve();
    expect(at).toMatchObject({ label: 'g/sub/p', name: 'p', ref: 'claude/x', sha: S2, path: 'docs/a.md' });
    expect(asked).toHaveLength(2);
  });

  it('一覧はページを追って blob だけ、中身は files/raw', async () => {
    const page = (n: number) => `${API}/repository/tree?ref=${SHA}&recursive=true&per_page=100&page=${n}`;
    const full = Array.from({ length: 100 }, (_, i) => ({ path: `d/${i}.md`, type: 'blob' }));
    const { fetch, asked } = fake({
      [page(1)]: full, [page(2)]: [{ path: 'd', type: 'tree' }, { path: 'last.dgm', type: 'blob' }],
    }, { [`${API}/repository/files/docs%2F%E5%9B%B3.md/raw?ref=${SHA}`]: '# 図' });
    const host = open(`https://gitlab.com/g/sub/p/-/tree/${SHA}`, fetch, 'glpat-x');
    const at = await host.resolve();
    const { paths } = await host.files(at);
    expect(paths).toHaveLength(101);
    expect(paths.at(-1)).toBe('last.dgm');
    expect(await host.text(at, 'docs/図.md')).toBe('# 図');
    expect(asked.every(one => one.headers['PRIVATE-TOKEN'] === 'glpat-x')).toBe(true);
  });

  it('プロジェクトだけなら既定ブランチ、戻りの URL は /-/ の形', async () => {
    const { fetch } = fake({
      [API]: { default_branch: 'main' }, [`${API}/repository/commits/main`]: { id: S1 },
    });
    const host = open('https://gitlab.com/g/sub/p', fetch);
    const at = await host.resolve();
    expect(at).toMatchObject({ ref: 'main', sha: S1, kind: 'tree', path: '' });
    expect(host.webUrl({ kind: 'blob', path: 'a.md', sha: S1 })).toBe(`https://gitlab.com/g/sub/p/-/blob/${S1}/a.md`);
    expect(host.webUrl({ kind: 'tree', path: '', sha: S1 }, 'main')).toBe('https://gitlab.com/g/sub/p/-/tree/main');
  });
});

describe('Gitea / Forgejo', () => {
  const API = 'https://codeberg.org/api/v1/repos/o/r';

  it('src/branch の / 入りのブランチ、src/commit は API を呼ばない', async () => {
    const { fetch } = fake({ [`${API}/branches?limit=50`]: [{ name: 'feat/x', commit: { id: S2 } }] });
    expect(await open('https://codeberg.org/o/r/src/branch/feat/x/docs/a.md', fetch).resolve())
      .toMatchObject({ ref: 'feat/x', sha: S2, path: 'docs/a.md' });
    const { fetch: none, asked } = fake({});
    expect(await open(`https://codeberg.org/o/r/src/commit/${SHA}/docs`, none).resolve()).toMatchObject({ sha: SHA, path: 'docs' });
    expect(asked).toEqual([]);
  });

  it('タグは tags から、一覧に無い ref は commits?sha= に尋ねる', async () => {
    const { fetch } = fake({
      [`${API}/tags?limit=50`]: [{ name: 'v2', commit: { sha: S1 } }],
      [`${API}/branches?limit=50`]: [],
      [`${API}/commits?sha=old%2Fbranch&limit=1&stat=false&verification=false&files=false`]: [{ sha: S2 }],
      [`${API}/commits?sha=old&limit=1&stat=false&verification=false&files=false`]: [],
    });
    expect(await open('https://codeberg.org/o/r/src/tag/v2/a.md', fetch).resolve()).toMatchObject({ ref: 'v2', sha: S1 });
    expect(await open('https://codeberg.org/o/r/src/branch/old/branch/a.md', fetch).resolve())
      .toMatchObject({ ref: 'old/branch', sha: S2, path: 'a.md' });
  });

  it('一覧は truncated のあいだページを追う。トークンは token 形式で', async () => {
    const page = (n: number) => `${API}/git/trees/${SHA}?recursive=true&per_page=1000&page=${n}`;
    const { fetch, asked } = fake({
      [page(1)]: { tree: [{ path: 'a.md', type: 'blob' }, { path: 'd', type: 'tree' }], truncated: true },
      [page(2)]: { tree: [{ path: 'd/b.dgm', type: 'blob' }], truncated: false },
    }, { [`${API}/raw/d/b.dgm?ref=${SHA}`]: 'free {}' });
    const host = open(`https://codeberg.org/o/r/src/commit/${SHA}/a.md`, fetch, 'tok');
    const at = await host.resolve();
    expect((await host.files(at)).paths).toEqual(['a.md', 'd/b.dgm']);
    expect(await host.text(at, 'd/b.dgm')).toBe('free {}');
    expect(asked.every(one => one.headers['Authorization'] === 'token tok')).toBe(true);
    expect(host.webUrl({ kind: 'blob', path: 'a.md', sha: SHA })).toBe(`https://codeberg.org/o/r/src/commit/${SHA}/a.md`);
  });
});

describe('Azure DevOps', () => {
  const API = 'https://dev.azure.com/org/proj/_apis/git/repositories/repo';
  const V = 'api-version=6.0';

  it('version= のブランチ（/ 入りも）を refs から、名前は丸ごと一致で', async () => {
    const { fetch } = fake({
      [`${API}/refs?filter=heads%2Ffeat%2Fx&peelTags=true&${V}`]: {
        value: [{ name: 'refs/heads/feat/x-old', objectId: S1 }, { name: 'refs/heads/feat/x', objectId: S2 }],
      },
    });
    const at = await open('https://dev.azure.com/org/proj/_git/repo?path=/docs/a.md&version=GBfeat/x', fetch).resolve();
    expect(at).toMatchObject({ label: 'proj/repo', ref: 'feat/x', sha: S2, path: 'docs/a.md', kind: 'blob' });
  });

  it('注釈付きタグは指す先のコミット。既定ブランチはリポジトリから', async () => {
    const { fetch } = fake({
      [`${API}/refs?filter=tags%2Fv1&peelTags=true&${V}`]: { value: [{ name: 'refs/tags/v1', objectId: S1, peeledObjectId: S2 }] },
      [`${API}?${V}`]: { defaultBranch: 'refs/heads/develop' },
      [`${API}/refs?filter=heads%2Fdevelop&peelTags=true&${V}`]: { value: [{ name: 'refs/heads/develop', objectId: SHA }] },
    });
    expect(await open('https://dev.azure.com/org/proj/_git/repo?version=GTv1', fetch).resolve()).toMatchObject({ sha: S2, kind: 'tree' });
    expect(await open('https://dev.azure.com/org/proj/_git/repo', fetch).resolve()).toMatchObject({ ref: 'develop', sha: SHA });
  });

  it('一覧は items の Full、中身は octetStream。トークンは Basic の password', async () => {
    const version = `versionDescriptor.version=${SHA}&versionDescriptor.versionType=commit`;
    const { fetch, asked } = fake({
      [`${API}/items?scopePath=%2F&recursionLevel=Full&${version}&${V}`]: {
        value: [{ path: '/', gitObjectType: 'tree' }, { path: '/docs/a.md', gitObjectType: 'blob' }],
      },
    }, { [`${API}/items?path=%2Fdocs%2Fa.md&${version}&$format=octetStream&${V}`]: '# A' });
    const host = open(`https://dev.azure.com/org/proj/_git/repo?path=/docs/a.md&version=GC${SHA}`, fetch, 'pat');
    const at = await host.resolve();
    expect((await host.files(at)).paths).toEqual(['docs/a.md']);
    expect(await host.text(at, 'docs/a.md')).toBe('# A');
    expect(asked.every(one => one.headers['Authorization'] === `Basic ${btoa(':pat')}`)).toBe(true);
    expect(asked.every(one => one.redirect === 'manual')).toBe(true);
  });

  it('サインインへの転送はトークンを求める', async () => {
    const redirected = Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' });
    Object.defineProperty(redirected, 'ok', { value: false });
    const { fetch } = fake({ [`${API}?${V}`]: redirected });
    await expect(open('https://dev.azure.com/org/proj/_git/repo', fetch).resolve())
      .rejects.toMatchObject({ id: 'web.error.signIn', wantsToken: true });
  });

  it('サーバ版はコレクションまでが起点。戻りの URL は path と version を持つ', async () => {
    const host = open('https://tfs.local/DefaultCollection/proj/_git/repo?path=/a.md', fake({}).fetch);
    expect(host.origin).toBe('https://tfs.local/DefaultCollection');
    expect(host.tokenHelp.url).toBe('https://tfs.local/DefaultCollection/_usersSettings/tokens');
    const back = host.webUrl({ kind: 'blob', path: 'docs/a.md', sha: SHA });
    expect(back).toBe(`https://tfs.local/DefaultCollection/proj/_git/repo?path=%2Fdocs%2Fa.md&version=GC${SHA}`);
    expect(await open(back, fake({}).fetch).resolve()).toMatchObject({ sha: SHA, path: 'docs/a.md' });
  });
});

describe('失敗の言い方', () => {
  it('回数制限は解除の時刻を添え、トークンが無ければトークンを勧める', () => {
    const error = failure(new Response('', {
      status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' },
    }), 'u', 'o/r');
    expect(error).toBeInstanceOf(ViewerError);
    expect(error).toMatchObject({ id: 'web.error.rateLimit', wantsToken: true });
    expect(error.params['time']).toBe(new Date(1_700_000_000_000).toLocaleTimeString());
  });

  it('401 は、トークンがあればトークンが効かないと言う', () => {
    expect(failure(new Response('', { status: 401 }), 'u', 'o/r', true)).toMatchObject({ id: 'web.error.badToken' });
    expect(failure(new Response('', { status: 401 }), 'u', 'o/r')).toMatchObject({ id: 'web.error.signIn' });
  });

  it('サインインへの転送（3xx）もサインインが要ると言う', () => {
    expect(failure(new Response(null, { status: 302 }), 'u', 'x')).toMatchObject({ id: 'web.error.signIn', wantsToken: true });
  });

  it('API の代わりにサインイン画面が返ってきたら、サインインが要ると言う', () => {
    expect(failure(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'u', 'x'))
      .toMatchObject({ id: 'web.error.signIn' });
  });

  it('接続できなければ、どのホストかを添えて言う', async () => {
    const host = open('https://gitlab.example.local/g/p/-/tree/main', async () => { throw new TypeError('Failed to fetch'); });
    await expect(host.resolve()).rejects.toMatchObject({
      id: 'web.error.network', params: { host: 'gitlab.example.local', message: 'Failed to fetch' },
    });
  });
});

describe('トークンの置き場', () => {
  const memory = (): TokenStorage & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: k => { map.delete(k); } };
  };

  it('起点ごとに置き、消せる', () => {
    const tokens = new Tokens(memory());
    expect(tokens.set('https://github.com', ' ghp_x ')).toBe(true);
    expect(tokens.get('https://github.com')).toBe('ghp_x');
    expect(tokens.get('https://gitlab.com')).toBeUndefined();
    tokens.forget('https://github.com');
    expect(tokens.get('https://github.com')).toBeUndefined();
  });

  it('http の起点には置かないし渡さない', () => {
    const storage = memory();
    const tokens = new Tokens(storage);
    expect(tokens.set('http://git.local', 'x')).toBe(false);
    storage.map.set('docpresenter.token:http://git.local', 'x');
    expect(tokens.get('http://git.local')).toBeUndefined();
  });

  it('置けないブラウザでも落ちない', () => {
    const tokens = new Tokens({
      getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => undefined,
    });
    expect(tokens.set('https://github.com', 'x')).toBe(false);
    expect(tokens.get('https://github.com')).toBeUndefined();
    expect(new Tokens(undefined).set('https://github.com', 'x')).toBe(false);
  });
});
