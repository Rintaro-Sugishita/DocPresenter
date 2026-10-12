// Reading a public repository on GitHub straight from the browser.
//
// The document's content never passes through a server of ours: the REST API
// and the raw host both answer cross-origin requests, so the page asks GitHub
// itself (design/web-viewer.md §1). Everything here takes `fetch` as a value,
// so the tests can stand in for GitHub.

import type { Params } from '@docpresenter/base';

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

/** What an address names before its ref is known. */
export interface GitHubAddress {
  readonly owner: string;
  readonly repo: string;
  /** A file (`blob/`, raw) or a folder (`tree/`, the repository itself). */
  readonly kind: 'blob' | 'tree';
  /** The ref and the path, run together: a branch name may hold `/` itself. */
  readonly rest: readonly string[];
}

/** An address with its ref settled on a commit. */
export interface Location {
  readonly owner: string;
  readonly repo: string;
  readonly kind: 'blob' | 'tree';
  /** The ref as the address wrote it (or the default branch). */
  readonly ref: string;
  /** The commit it pointed at when it was read; everything is read from this. */
  readonly sha: string;
  /** Inside the repository, without a leading `/`. Empty for the root. */
  readonly path: string;
}

/** A failure the page says out loud, as a message id and its parameters. */
export class ViewerError extends Error {
  constructor(readonly id: string, readonly params: Params = {}, readonly detail?: unknown) {
    super(id);
  }
}

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const SHA = /^[0-9a-f]{40}$/i;
const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Splits a GitHub address into owner, repository and the rest. Undefined when
 * it is not one this page can show — the page then says which forms it takes.
 */
export function parseAddress(text: string): GitHubAddress | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const segments = url.pathname.split('/').filter(segment => segment !== '').map(decode);
  const host = url.hostname.toLowerCase();

  if (host === 'raw.githubusercontent.com') {
    const [owner, repo, ...rest] = segments;
    if (!owner || !repo || rest.length < 2) return undefined;
    // The raw host also takes `refs/heads/<branch>/…`; the ref is what follows.
    const bare = rest[0] === 'refs' && (rest[1] === 'heads' || rest[1] === 'tags') ? rest.slice(2) : rest;
    return valid({ owner, repo, kind: 'blob', rest: bare });
  }
  if (host !== 'github.com' && host !== 'www.github.com') return undefined;
  const [owner, repo, mode, ...rest] = segments;
  if (!owner || !repo) return undefined;
  const name = repo.replace(/\.git$/i, '');
  if (mode === undefined) return valid({ owner, repo: name, kind: 'tree', rest: [] });
  if (mode === 'blob' || mode === 'raw') {
    return rest.length < 2 ? undefined : valid({ owner, repo: name, kind: 'blob', rest });
  }
  if (mode === 'tree') return valid({ owner, repo: name, kind: 'tree', rest });
  return undefined;
}

function decode(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function valid(address: GitHubAddress): GitHubAddress | undefined {
  return NAME.test(address.owner) && NAME.test(address.repo) ? address : undefined;
}

/** The address of a location on github.com, for links out and for sharing. */
export function githubUrl(location: Pick<Location, 'owner' | 'repo' | 'kind' | 'path'>, ref: string): string {
  const path = location.path === '' ? '' : `/${encodePath(location.path)}`;
  return `https://github.com/${location.owner}/${location.repo}/${location.kind}/${encodePath(ref)}${path}`;
}

/** A path for a URL: each segment encoded, the slashes kept. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Talks to GitHub for one page. Answers are kept for as long as the page is
 * open: switching the language redraws without spending the reader's 60
 * calls an hour again, and a commit's files never change.
 */
export class GitHub {
  private readonly kept = new Map<string, Promise<unknown>>();

  constructor(private readonly fetch: Fetch) {}

  /** The answer for `key`, asked once. A failure is not kept: asking again may work. */
  private once<T>(key: string, ask: () => Promise<T>): Promise<T> {
    let found = this.kept.get(key) as Promise<T> | undefined;
    if (!found) {
      found = ask();
      this.kept.set(key, found);
      found.catch(() => this.kept.delete(key));
    }
    return found;
  }

  /**
   * Settles the ref on a commit. A branch may be called `claude/x`, so
   * `blob/claude/x/docs/a.md` cannot be split by looking at it: the longest
   * branch or tag the address begins with wins, as GitHub itself decides.
   */
  async resolve(address: GitHubAddress): Promise<Location> {
    const { owner, repo, kind, rest } = address;
    const at = (ref: string, sha: string, used: number): Location =>
      ({ owner, repo, kind, ref, sha, path: rest.slice(used).join('/') });

    if (rest.length === 0) {
      const info = await this.json<{ default_branch: string }>(`/repos/${owner}/${repo}`, `${owner}/${repo}`);
      return at(info.default_branch, await this.commit(owner, repo, info.default_branch), 0);
    }
    if (SHA.test(rest[0]!)) return at(rest[0]!, rest[0]!.toLowerCase(), 1);

    // One page of branches and one of tags covers almost every repository in
    // two calls, and hands over the commit with the name.
    const joined = rest.join('/');
    const named = [
      ...await this.json<{ name: string; commit: { sha: string } }[]>(
        `/repos/${owner}/${repo}/branches?per_page=100`, `${owner}/${repo}`),
      ...await this.json<{ name: string; commit: { sha: string } }[]>(
        `/repos/${owner}/${repo}/tags?per_page=100`, `${owner}/${repo}`),
    ];
    const best = longestRef(joined, named.map(one => one.name));
    if (best !== undefined) {
      const sha = named.find(one => one.name === best)!.commit.sha;
      return at(best, sha, best.split('/').length);
    }

    // More than a page of them: ask about each prefix in turn. Short first,
    // since most refs have no `/` in them; a handful of calls at most.
    for (let used = 1; used <= Math.min(rest.length, 5); used++) {
      const ref = rest.slice(0, used).join('/');
      const sha = await this.commit(owner, repo, ref).catch(error => {
        if (error instanceof ViewerError && error.id === 'web.error.notFound') return undefined;
        throw error;
      });
      if (sha !== undefined) return at(ref, sha, used);
    }
    throw new ViewerError('web.error.ref', { path: joined });
  }

  /** Every file in the commit, and whether GitHub cut the list short. */
  async files(location: Location): Promise<{ paths: readonly string[]; truncated: boolean }> {
    const tree = await this.json<{ tree: { path: string; type: string }[]; truncated?: boolean }>(
      `/repos/${location.owner}/${location.repo}/git/trees/${location.sha}?recursive=1`,
      `${location.owner}/${location.repo}`);
    return {
      paths: tree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path),
      truncated: tree.truncated === true,
    };
  }

  /** A file's text, from the raw host: it is not counted against the API limit. */
  text(location: Location, path: string): Promise<string | undefined> {
    return this.once(`text:${location.sha}:${path}`, async () => {
      const response = await this.raw(location, path);
      return response === undefined ? undefined : response.text();
    });
  }

  /** A picture as a `data:` URL. */
  image(location: Location, path: string): Promise<string | undefined> {
    return this.once(`image:${location.sha}:${path}`, async () => {
      const response = await this.raw(location, path);
      if (response === undefined) return undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return `data:${imageType(path)};base64,${base64(bytes)}`;
    });
  }

  private async raw(location: Location, path: string): Promise<Response | undefined> {
    const url = `${RAW}/${location.owner}/${location.repo}/${location.sha}/${encodePath(path)}`;
    const response = await this.request(url);
    return response.ok ? response : undefined;
  }

  private async commit(owner: string, repo: string, ref: string): Promise<string> {
    const commit = await this.json<{ sha: string }>(
      `/repos/${owner}/${repo}/commits/${encodePath(ref)}`, `${owner}/${repo}`);
    return commit.sha;
  }

  private json<T>(path: string, what: string): Promise<T> {
    return this.once(`api:${path}`, async () => {
      const url = `${API}${path}`;
      const response = await this.request(url, { headers: { Accept: 'application/vnd.github+json' } });
      if (response.ok) return await response.json() as T;
      throw failure(response, url, what);
    });
  }

  private async request(url: string, init?: { headers?: Record<string, string> }): Promise<Response> {
    try {
      return await this.fetch(url, init);
    } catch (error) {
      throw new ViewerError('web.error.network', { message: error instanceof Error ? error.message : String(error) }, error);
    }
  }
}

/** The longest of `names` that `path` is, or begins with as a folder. */
export function longestRef(path: string, names: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const name of names) {
    if (path !== name && !path.startsWith(`${name}/`)) continue;
    if (best === undefined || name.length > best.length) best = name;
  }
  return best;
}

/** Says why GitHub refused, in the words the page uses. */
export function failure(response: Response, url: string, what: string): ViewerError {
  const remaining = response.headers.get('x-ratelimit-remaining');
  if ((response.status === 403 || response.status === 429) && remaining === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    return Number.isFinite(reset) && reset > 0
      ? new ViewerError('web.error.rateLimit', { time: new Date(reset * 1000).toLocaleTimeString() })
      : new ViewerError('web.error.rateLimitUnknown');
  }
  if (response.status === 404) return new ViewerError('web.error.notFound', { what });
  return new ViewerError('web.error.http', { status: String(response.status), url });
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp',
};

function imageType(path: string): string {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  return IMAGE_TYPES[extension] ?? 'application/octet-stream';
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  // In slices: one call per byte is slow, one call for all of them overflows.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
