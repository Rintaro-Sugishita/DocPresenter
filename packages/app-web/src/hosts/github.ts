// GitHub and GitHub Enterprise Server.
//
// A public repository is read as stage 1 read it: the API for the ref and the
// file list, the raw host for the content, which is not counted against the
// 60 calls an hour. With a token, or on Enterprise, the content comes through
// the API instead: the raw host does not let a page send a token to it.

import {
  dataUrl, decodeText, encodePath, HostBase, splitRef, type Host, type HostContext, type Location,
} from './base.js';

/** What a GitHub address names before its ref is known. */
export interface GitHubAddress {
  /** `https://github.com`, or an Enterprise server's own origin. */
  readonly origin: string;
  readonly owner: string;
  readonly repo: string;
  readonly kind: 'blob' | 'tree';
  /** The ref and the path, run together: a branch name may hold `/` itself. */
  readonly rest: readonly string[];
}

const NAME = /^[A-Za-z0-9_.-]+$/;
const DOT_COM = 'https://github.com';

/**
 * Reads a GitHub address. `segments` are the path's, decoded. Undefined when
 * it is not one this page can show.
 */
export function parseGitHub(url: URL, segments: readonly string[]): GitHubAddress | undefined {
  const host = url.hostname.toLowerCase();
  if (host === 'raw.githubusercontent.com') {
    const [owner, repo, ...rest] = segments;
    if (!owner || !repo || rest.length < 2) return undefined;
    // The raw host also takes `refs/heads/<branch>/…`; the ref is what follows.
    const bare = rest[0] === 'refs' && (rest[1] === 'heads' || rest[1] === 'tags') ? rest.slice(2) : rest;
    return valid({ origin: DOT_COM, owner, repo, kind: 'blob', rest: bare });
  }
  const dotCom = host === 'github.com' || host === 'www.github.com';
  const origin = dotCom ? DOT_COM : url.origin;
  const [owner, repo, mode, ...rest] = segments;
  if (!owner || !repo) return undefined;
  const name = repo.replace(/\.git$/i, '');
  // On another server, `owner/repo` alone could be any kind of host.
  if (mode === undefined) return dotCom ? valid({ origin, owner, repo: name, kind: 'tree', rest: [] }) : undefined;
  if (mode === 'blob' || mode === 'raw') {
    return rest.length < 2 ? undefined : valid({ origin, owner, repo: name, kind: 'blob', rest });
  }
  if (mode === 'tree') return valid({ origin, owner, repo: name, kind: 'tree', rest });
  return undefined;
}

function valid(address: GitHubAddress): GitHubAddress | undefined {
  return NAME.test(address.owner) && NAME.test(address.repo) ? address : undefined;
}

/** The address of a location on github.com, for links out and for sharing. */
export function githubUrl(
  location: Pick<Location, 'kind' | 'path'> & { owner: string; repo: string; origin?: string }, ref: string,
): string {
  const path = location.path === '' ? '' : `/${encodePath(location.path)}`;
  return `${location.origin ?? DOT_COM}/${location.owner}/${location.repo}/${location.kind}/${encodePath(ref)}${path}`;
}

export class GitHub extends HostBase implements Host {
  readonly type = 'github';
  readonly origin: string;
  readonly tokenHelp: { url: string; scope: string };
  private readonly api: string;
  private readonly prefix: string;

  constructor(private readonly address: GitHubAddress, context: HostContext) {
    const dotCom = address.origin === DOT_COM;
    super(context, dotCom ? 'GitHub' : new URL(address.origin).host, `${address.owner}/${address.repo}`);
    this.origin = address.origin;
    this.api = dotCom ? 'https://api.github.com' : `${address.origin}/api/v3`;
    this.prefix = `${this.api}/repos/${address.owner}/${address.repo}`;
    this.tokenHelp = {
      url: dotCom ? 'https://github.com/settings/personal-access-tokens/new' : `${address.origin}/settings/tokens`,
      scope: dotCom ? 'Fine-grained: Contents — Read-only' : 'repo',
    };
  }

  protected authorization(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  async resolve(): Promise<Location> {
    const { kind, rest, repo } = this.address;
    const at = (ref: string, sha: string, used: number): Location =>
      ({ label: this.label, name: repo, kind, ref, sha, path: rest.slice(used).join('/') });

    if (rest.length === 0) {
      const info = await this.json<{ default_branch: string }>(this.prefix);
      return at(info.default_branch, await this.commit(info.default_branch), 0);
    }
    // One page of branches and one of tags covers almost every repository in
    // two calls, and hands over the commit with the name.
    const { ref, sha, used } = await splitRef(rest, async () => {
      type Named = { name: string; commit: { sha: string } }[];
      const [branches, tags] = await Promise.all([
        this.json<Named>(`${this.prefix}/branches?per_page=100`),
        this.json<Named>(`${this.prefix}/tags?per_page=100`),
      ]);
      return [...branches, ...tags].map(one => ({ name: one.name, sha: one.commit.sha }));
    }, ref => this.commit(ref));
    return at(ref, sha, used);
  }

  async files(at: Location): Promise<{ paths: readonly string[]; truncated: boolean }> {
    const tree = await this.json<{ tree: { path: string; type: string }[]; truncated?: boolean }>(
      `${this.prefix}/git/trees/${at.sha}?recursive=1`);
    return {
      paths: tree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path),
      truncated: tree.truncated === true,
    };
  }

  async text(at: Location, path: string): Promise<string | undefined> {
    return decodeText(await this.content(at, path));
  }

  async image(at: Location, path: string): Promise<string | undefined> {
    const bytes = await this.content(at, path);
    return bytes === undefined ? undefined : dataUrl(path, bytes);
  }

  webUrl(at: Pick<Location, 'kind' | 'path' | 'sha'>, ref?: string): string {
    return githubUrl({ ...at, owner: this.address.owner, repo: this.address.repo, origin: this.origin }, ref ?? at.sha);
  }

  private content(at: Location, path: string): Promise<Uint8Array | undefined> {
    const { owner, repo } = this.address;
    // The raw host is free of the API's limit, but takes no token.
    if (this.origin === DOT_COM && this.context.token === undefined) {
      return this.bytes(`${at.sha}:${path}`, `https://raw.githubusercontent.com/${owner}/${repo}/${at.sha}/${encodePath(path)}`);
    }
    return this.bytes(`${at.sha}:${path}`, `${this.prefix}/contents/${encodePath(path)}?ref=${at.sha}`,
      { Accept: 'application/vnd.github.raw+json' });
  }

  private async commit(ref: string): Promise<string> {
    return (await this.json<{ sha: string }>(`${this.prefix}/commits/${encodePath(ref)}`)).sha;
  }
}
