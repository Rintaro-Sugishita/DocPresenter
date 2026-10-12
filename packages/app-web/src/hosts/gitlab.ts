// GitLab: gitlab.com and self-managed servers, API v4.
//
// A project lives under any depth of groups, so its path is everything before
// the `/-/` that starts the ref: `group/sub/project/-/blob/main/docs/a.md`.

import {
  dataUrl, decodeText, encodePath, HostBase, splitRef, type Host, type HostContext, type Location,
} from './base.js';

export interface GitLabAddress {
  readonly origin: string;
  /** `group/sub/project`. */
  readonly project: string;
  readonly kind: 'blob' | 'tree';
  readonly rest: readonly string[];
}

/** Reads a GitLab address: `…/-/blob|tree|raw/…`, or a project on gitlab.com. */
export function parseGitLab(url: URL, segments: readonly string[]): GitLabAddress | undefined {
  const dash = segments.indexOf('-');
  if (dash >= 2) {
    const mode = segments[dash + 1];
    const rest = segments.slice(dash + 2);
    const project = segments.slice(0, dash).join('/');
    if (mode === 'tree') return { origin: url.origin, project, kind: 'tree', rest };
    if ((mode === 'blob' || mode === 'raw') && rest.length >= 2) return { origin: url.origin, project, kind: 'blob', rest };
    return undefined;
  }
  // Only on gitlab.com is a bare path known to be a project.
  if (url.hostname.toLowerCase() === 'gitlab.com' && segments.length >= 2) {
    return { origin: url.origin, project: segments.join('/').replace(/\.git$/i, ''), kind: 'tree', rest: [] };
  }
  return undefined;
}

/** How many pages of the file list to read before saying it was cut short. */
const MOST_PAGES = 50;

export class GitLab extends HostBase implements Host {
  readonly type = 'gitlab';
  readonly origin: string;
  readonly tokenHelp: { url: string; scope: string };
  private readonly api: string;

  constructor(private readonly address: GitLabAddress, context: HostContext) {
    super(context, address.origin === 'https://gitlab.com' ? 'GitLab' : new URL(address.origin).host, address.project);
    this.origin = address.origin;
    this.api = `${address.origin}/api/v4/projects/${encodeURIComponent(address.project)}`;
    this.tokenHelp = { url: `${address.origin}/-/user_settings/personal_access_tokens`, scope: 'read_api' };
  }

  protected authorization(token: string): Record<string, string> {
    return { 'PRIVATE-TOKEN': token };
  }

  async resolve(): Promise<Location> {
    const { kind, rest, project } = this.address;
    const at = (ref: string, sha: string, used: number): Location => ({
      label: this.label, name: project.slice(project.lastIndexOf('/') + 1), kind, ref, sha,
      path: rest.slice(used).join('/'),
    });
    if (rest.length === 0) {
      const info = await this.json<{ default_branch: string }>(this.api);
      return at(info.default_branch, await this.commit(info.default_branch), 0);
    }
    // Branches and tags that begin as the address does: the search keeps it
    // to one page however many the project has.
    const { ref, sha, used } = await splitRef(rest, async () => {
      type Named = { name: string; commit: { id: string } }[];
      const search = encodeURIComponent(`^${rest[0]}`);
      const [branches, tags] = await Promise.all([
        this.json<Named>(`${this.api}/repository/branches?per_page=100&search=${search}`),
        this.json<Named>(`${this.api}/repository/tags?per_page=100&search=${search}`),
      ]);
      return [...branches, ...tags].map(one => ({ name: one.name, sha: one.commit.id }));
    }, ref => this.commit(ref));
    return at(ref, sha, used);
  }

  async files(at: Location): Promise<{ paths: readonly string[]; truncated: boolean }> {
    const paths: string[] = [];
    for (let page = 1; page <= MOST_PAGES; page++) {
      const entries = await this.json<{ path: string; type: string }[]>(
        `${this.api}/repository/tree?ref=${at.sha}&recursive=true&per_page=100&page=${page}`);
      for (const entry of entries) if (entry.type === 'blob') paths.push(entry.path);
      if (entries.length < 100) return { paths, truncated: false };
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
    return `${this.origin}/${this.address.project}/-/${at.kind}/${encodePath(ref ?? at.sha)}${path}`;
  }

  private content(at: Location, path: string): Promise<Uint8Array | undefined> {
    return this.bytes(`${at.sha}:${path}`,
      `${this.api}/repository/files/${encodeURIComponent(path)}/raw?ref=${at.sha}`);
  }

  private async commit(ref: string): Promise<string> {
    return (await this.json<{ id: string }>(`${this.api}/repository/commits/${encodeURIComponent(ref)}`)).id;
  }
}
