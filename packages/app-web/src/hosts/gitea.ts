// Gitea and Forgejo (Codeberg among them), API v1.
//
// Their addresses say what kind of ref they hold —
// `owner/repo/src/branch/<branch>/<path>`, `…/src/tag/…`, `…/src/commit/<sha>/…`
// — though a branch name may still hold `/`.

import {
  dataUrl, decodeText, encodePath, HostBase, splitRef, ViewerError, type Host, type HostContext, type Location,
} from './base.js';

export interface GiteaAddress {
  readonly origin: string;
  readonly owner: string;
  readonly repo: string;
  /** Which kind of ref `rest` begins with; undefined for the repository itself. */
  readonly refKind?: 'branch' | 'tag' | 'commit';
  readonly rest: readonly string[];
}

/** Hosts known to run Gitea or Forgejo, where `owner/repo` alone is a repository. */
const KNOWN = new Set(['codeberg.org', 'gitea.com']);

/** Reads `owner/repo/src|raw/branch|tag|commit/…`, or a repository on a known host. */
export function parseGitea(url: URL, segments: readonly string[]): GiteaAddress | undefined {
  const [owner, repo, mode, refKind, ...rest] = segments;
  if (!owner || !repo) return undefined;
  if ((mode === 'src' || mode === 'raw' || mode === 'media')
    && (refKind === 'branch' || refKind === 'tag' || refKind === 'commit') && rest.length >= 1) {
    return { origin: url.origin, owner, repo, refKind, rest };
  }
  if (mode === undefined && KNOWN.has(url.hostname.toLowerCase())) {
    return { origin: url.origin, owner, repo: repo.replace(/\.git$/i, ''), rest: [] };
  }
  return undefined;
}

/** How many pages of the file list to read before saying it was cut short. */
const MOST_PAGES = 30;

export class Gitea extends HostBase implements Host {
  readonly type = 'gitea';
  readonly origin: string;
  readonly tokenHelp: { url: string; scope: string };
  private readonly api: string;

  constructor(private readonly address: GiteaAddress, context: HostContext) {
    super(context, new URL(address.origin).host, `${address.owner}/${address.repo}`);
    this.origin = address.origin;
    this.api = `${address.origin}/api/v1/repos/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.repo)}`;
    this.tokenHelp = { url: `${address.origin}/user/settings/applications`, scope: 'repository: Read' };
  }

  protected authorization(token: string): Record<string, string> {
    return { Authorization: `token ${token}` };
  }

  async resolve(): Promise<Location> {
    const { rest, refKind, repo } = this.address;
    // The address cannot say whether it is a file or a folder (`src/` is both);
    // the listing will.
    const at = (ref: string, sha: string, used: number): Location =>
      ({ label: this.label, name: repo, kind: rest.length === 0 ? 'tree' : 'blob', ref, sha, path: rest.slice(used).join('/') });
    if (refKind === undefined) {
      const info = await this.json<{ default_branch: string }>(this.api);
      return at(info.default_branch, await this.commit(info.default_branch), 0);
    }
    if (refKind === 'commit') return at(rest[0]!, rest[0]!.toLowerCase(), 1);
    const { ref, sha, used } = await splitRef(rest, async () => {
      if (refKind === 'branch') {
        const branches = await this.json<{ name: string; commit: { id: string } }[]>(`${this.api}/branches?limit=50`);
        return branches.map(one => ({ name: one.name, sha: one.commit.id }));
      }
      const tags = await this.json<{ name: string; commit: { sha: string } }[]>(`${this.api}/tags?limit=50`);
      return tags.map(one => ({ name: one.name, sha: one.commit.sha }));
    }, ref => this.commit(ref));
    return at(ref, sha, used);
  }

  async files(at: Location): Promise<{ paths: readonly string[]; truncated: boolean }> {
    const paths: string[] = [];
    for (let page = 1; page <= MOST_PAGES; page++) {
      const tree = await this.json<{ tree: { path: string; type: string }[] | null; truncated?: boolean }>(
        `${this.api}/git/trees/${at.sha}?recursive=true&per_page=1000&page=${page}`);
      for (const entry of tree.tree ?? []) if (entry.type === 'blob') paths.push(entry.path);
      // Gitea says `truncated` when there is another page to read.
      if (!tree.truncated) return { paths, truncated: false };
    }
    return { paths, truncated: true };
  }

  async text(at: Location, path: string): Promise<string | undefined> {
    return decodeText(await this.content(at, path));
  }

  async image(at: Location, path: string): Promise<string | undefined> {
    const bytes = await this.content(at, path);
    return bytes === undefined ? undefined : dataUrl(path, bytes);
  }

  webUrl(at: Pick<Location, 'kind' | 'path' | 'sha'>, ref?: string): string {
    const path = at.path === '' ? '' : `/${encodePath(at.path)}`;
    const base = `${this.origin}/${this.address.owner}/${this.address.repo}/src`;
    if (ref === undefined) return `${base}/commit/${at.sha}${path}`;
    return `${base}/${this.address.refKind === 'tag' ? 'tag' : 'branch'}/${encodePath(ref)}${path}`;
  }

  private content(at: Location, path: string): Promise<Uint8Array | undefined> {
    return this.bytes(`${at.sha}:${path}`, `${this.api}/raw/${encodePath(path)}?ref=${at.sha}`);
  }

  /** The commit a branch or tag points at. The query form takes a name with `/` in it. */
  private async commit(ref: string): Promise<string> {
    const commits = await this.json<{ sha: string }[]>(
      `${this.api}/commits?sha=${encodeURIComponent(ref)}&limit=1&stat=false&verification=false&files=false`);
    const sha = commits[0]?.sha;
    // An empty list is Gitea's way of saying there is no such ref.
    if (!sha) throw new ViewerError('web.error.notFound', { what: ref }, undefined, true);
    return sha;
  }
}
