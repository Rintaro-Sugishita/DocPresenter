// Azure DevOps: Services (dev.azure.com, *.visualstudio.com) and Server.
//
// The address keeps the path and the ref in its query —
// `…/{project}/_git/{repo}?path=/docs/a.md&version=GBmain` — so a branch with
// `/` in its name is no puzzle here. A token is per organisation (Services) or
// per collection (Server), and goes as the password of basic authentication.

import {
  dataUrl, decodeText, HostBase, SHA, ViewerError, type Host, type HostContext, type Location,
} from './base.js';

export interface AzureAddress {
  /** Up to the organisation or collection: `https://dev.azure.com/org`, `https://tfs.local/DefaultCollection`. */
  readonly base: string;
  readonly project: string;
  readonly repo: string;
  /** Inside the repository, without a leading `/`. */
  readonly path: string;
  /** `GBmain`, `GTv1.0`, `GC<sha>`, or undefined for the default branch. */
  readonly version?: string;
}

/** Reads `…/{project}/_git/{repo}`, with `path=` and `version=` in the query. */
export function parseAzure(url: URL, segments: readonly string[]): AzureAddress | undefined {
  const git = segments.indexOf('_git');
  if (git < 1 || segments[git + 1] === undefined) return undefined;
  const project = segments[git - 1]!;
  const repo = segments[git + 1]!;
  const host = url.hostname.toLowerCase();
  // On dev.azure.com the organisation is the first segment; on
  // {org}.visualstudio.com and on a server, whatever comes before the project.
  const before = segments.slice(0, git - 1);
  if (host === 'dev.azure.com' && before.length !== 1) return undefined;
  const base = [url.origin, ...before.map(encodeURIComponent)].join('/');
  const path = (url.searchParams.get('path') ?? '/').replace(/^\/+|\/+$/g, '');
  const version = url.searchParams.get('version') ?? undefined;
  if (version !== undefined && !/^G[BTC]./.test(version)) return undefined;
  return { base, project, repo, path, ...(version === undefined ? {} : { version }) };
}

/** Old enough for Azure DevOps Server 2020 and still served by Services. */
const API_VERSION = 'api-version=6.0';

export class Azure extends HostBase implements Host {
  readonly type = 'azure';
  readonly origin: string;
  readonly tokenHelp: { url: string; scope: string };
  private readonly api: string;

  constructor(private readonly address: AzureAddress, context: HostContext) {
    const services = /^https:\/\/(dev\.azure\.com|[^/]+\.visualstudio\.com)/i.test(address.base);
    super(context, services ? 'Azure DevOps' : new URL(address.base).host, `${address.project}/${address.repo}`);
    this.origin = address.base;
    this.api = `${address.base}/${encodeURIComponent(address.project)}/_apis/git/repositories/${encodeURIComponent(address.repo)}`;
    this.tokenHelp = { url: `${address.base}/_usersSettings/tokens`, scope: 'Code: Read' };
  }

  protected authorization(token: string): Record<string, string> {
    return { Authorization: `Basic ${btoa(`:${token}`)}` };
  }

  /**
   * Without a token Azure DevOps answers a private repository with a redirect
   * to its sign-in page, which a page may not follow across origins. Taken as
   * it comes, it says "sign in" rather than failing as an unreachable host.
   */
  protected override request(url: string, headers: Record<string, string> = {}): Promise<Response> {
    return super.request(url, headers, { redirect: 'manual' });
  }

  async resolve(): Promise<Location> {
    const { version, path, repo } = this.address;
    const at = (ref: string, sha: string): Location =>
      ({ label: this.label, name: repo, kind: path === '' ? 'tree' : 'blob', ref, sha, path });
    if (version === undefined) {
      const info = await this.json<{ defaultBranch?: string }>(`${this.api}?${API_VERSION}`);
      const branch = (info.defaultBranch ?? 'refs/heads/main').replace(/^refs\/heads\//, '');
      return at(branch, await this.ref(`heads/${branch}`));
    }
    const name = version.slice(2);
    if (version.startsWith('GC')) {
      if (!SHA.test(name)) throw new ViewerError('web.error.ref', { path: version });
      return at(name, name.toLowerCase());
    }
    return at(name, await this.ref(`${version.startsWith('GT') ? 'tags' : 'heads'}/${name}`));
  }

  async files(at: Location): Promise<{ paths: readonly string[]; truncated: boolean }> {
    const items = await this.json<{ value: { path: string; gitObjectType: string }[] }>(
      `${this.api}/items?scopePath=%2F&recursionLevel=Full&${this.version(at)}&${API_VERSION}`);
    return {
      paths: items.value.filter(item => item.gitObjectType === 'blob').map(item => item.path.replace(/^\//, '')),
      truncated: false,
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
    const version = ref === undefined ? `GC${at.sha}`
      : `${this.address.version?.startsWith('GT') ? 'GT' : 'GB'}${ref}`;
    const query = new URLSearchParams({ path: `/${at.path}`, version });
    return `${this.address.base}/${encodeURIComponent(this.address.project)}/_git/${encodeURIComponent(this.address.repo)}?${query}`;
  }

  private version(at: Location): string {
    return `versionDescriptor.version=${at.sha}&versionDescriptor.versionType=commit`;
  }

  private content(at: Location, path: string): Promise<Uint8Array | undefined> {
    return this.bytes(`${at.sha}:${path}`,
      `${this.api}/items?path=${encodeURIComponent(`/${path}`)}&${this.version(at)}&$format=octetStream&${API_VERSION}`);
  }

  /** The commit a branch or tag points at. The filter is a prefix, so the name is matched whole. */
  private async ref(name: string): Promise<string> {
    const refs = await this.json<{ value: { name: string; objectId: string; peeledObjectId?: string }[] }>(
      `${this.api}/refs?filter=${encodeURIComponent(name)}&peelTags=true&${API_VERSION}`);
    const found = refs.value.find(one => one.name === `refs/${name}`);
    if (!found) throw new ViewerError('web.error.ref', { path: name.replace(/^(heads|tags)\//, '') });
    // An annotated tag points at a tag object; the commit is under it.
    return found.peeledObjectId ?? found.objectId;
  }
}
