// What every Git host the viewer reads from has in common.
//
// The viewer reads a repository straight from the browser: the host's REST
// API answers cross-origin requests, so the document's content never passes
// through a server of ours (design/web-viewer.md §1, §7). A private repository
// takes a personal access token, which the reader pastes in and which goes to
// that host only. Each host (github.ts, gitlab.ts, gitea.ts, azure.ts) turns
// its own API into the four questions below.

import type { Params } from '@docpresenter/base';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type HostType = 'github' | 'gitlab' | 'gitea' | 'azure';

/** An address with its ref settled on a commit. */
export interface Location {
  /** The repository as the reader knows it: `owner/repo`, `group/project`, `org/project/repo`. */
  readonly label: string;
  /** The repository's own name, for the page title. */
  readonly name: string;
  /** A file or a folder, as the address said. A folder named as a file is told by the listing. */
  readonly kind: 'blob' | 'tree';
  /** The ref as the address wrote it (or the default branch). */
  readonly ref: string;
  /** The commit it pointed at when it was read; everything is read from this. */
  readonly sha: string;
  /** Inside the repository, without a leading `/`. Empty for the root. */
  readonly path: string;
}

/** One repository on one host, as an address named it. */
export interface Host {
  readonly type: HostType;
  /** Who the reader would recognise: GitHub, GitLab, or the server's own name. */
  readonly name: string;
  /**
   * Where a token for this repository is kept and sent: the host, or the
   * organisation on Azure DevOps, whose tokens are per organisation.
   */
  readonly origin: string;
  readonly label: string;
  /** Where the reader makes a token, and what it needs to be allowed. */
  readonly tokenHelp: { readonly url: string; readonly scope: string };
  resolve(): Promise<Location>;
  /** Every file in the commit, and whether the host cut the list short. */
  files(at: Location): Promise<{ paths: readonly string[]; truncated: boolean }>;
  text(at: Location, path: string): Promise<string | undefined>;
  /** A picture as a `data:` URL. */
  image(at: Location, path: string): Promise<string | undefined>;
  /**
   * The address of a file or folder on the host. Without `ref` it names the
   * commit, which is what a shared link should name. The viewer reads its own
   * output back, so whatever this writes, the host's parser takes.
   */
  webUrl(at: Pick<Location, 'kind' | 'path' | 'sha'>, ref?: string): string;
}

/** What a host is built with. */
export interface HostContext {
  readonly fetch: Fetch;
  /** The token the reader gave for this origin, if any. */
  readonly token?: string;
}

/** A failure the page says out loud, as a message id and its parameters. */
export class ViewerError extends Error {
  constructor(
    readonly id: string, readonly params: Params = {}, readonly detail?: unknown,
    /** True when a (different) token might get past it: the page then asks for one. */
    readonly wantsToken = false,
  ) {
    super(id);
  }
}

/** Answers kept for as long as the page is open, and what every host asks with. */
export abstract class HostBase {
  private readonly kept = new Map<string, Promise<unknown>>();

  constructor(protected readonly context: HostContext, readonly name: string, readonly label: string) {}

  /** The headers that carry the token, in the host's own way. */
  protected abstract authorization(token: string): Record<string, string>;

  /**
   * The answer for `key`, asked once. Switching the language redraws without
   * spending the reader's requests again, and a commit's files never change.
   * A failure is not kept: asking again may work.
   */
  protected once<T>(key: string, ask: () => Promise<T>): Promise<T> {
    let found = this.kept.get(key) as Promise<T> | undefined;
    if (!found) {
      found = ask();
      this.kept.set(key, found);
      found.catch(() => this.kept.delete(key));
    }
    return found;
  }

  protected async request(url: string, headers: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> {
    const token = this.context.token;
    try {
      return await this.context.fetch(url, {
        ...init, headers: { ...headers, ...(token ? this.authorization(token) : {}) },
      });
    } catch (error) {
      // A browser does not say why a request failed: no network, a name that
      // does not resolve, a host that does not allow this page (CORS), or a
      // private address the browser will not reach from a public page.
      throw new ViewerError('web.error.network', {
        host: new URL(url).host, message: error instanceof Error ? error.message : String(error),
      }, error);
    }
  }

  /** JSON from the API, or a ViewerError saying why not. */
  protected json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    return this.once(`json:${url}`, async () => {
      const response = await this.request(url, { Accept: 'application/json', ...headers });
      if (response.ok && isJson(response)) return await response.json() as T;
      throw this.failure(response, url);
    });
  }

  /** A file's bytes, or undefined when the host has no such file. */
  protected bytes(key: string, url: string, headers: Record<string, string> = {}): Promise<Uint8Array | undefined> {
    return this.once(`bytes:${key}`, async () => {
      const response = await this.request(url, headers);
      if (!response.ok) return undefined;
      return new Uint8Array(await response.arrayBuffer());
    });
  }

  /** Says why the host refused, in the words the page uses. */
  protected failure(response: Response, url: string): ViewerError {
    return failure(response, url, this.label, this.context.token !== undefined);
  }
}

/** Whether a response is the API answering, rather than a sign-in page in its place. */
function isJson(response: Response): boolean {
  const type = response.headers.get('content-type');
  return type === null || type.includes('json');
}

/** Says why a host refused, in the words the page uses. */
export function failure(response: Response, url: string, what: string, withToken = false): ViewerError {
  const remaining = response.headers.get('x-ratelimit-remaining');
  if ((response.status === 403 || response.status === 429) && remaining === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    return Number.isFinite(reset) && reset > 0
      ? new ViewerError('web.error.rateLimit', { time: new Date(reset * 1000).toLocaleTimeString() }, undefined, !withToken)
      : new ViewerError('web.error.rateLimitUnknown', {}, undefined, !withToken);
  }
  // A host that wants a sign-in answers with its sign-in page, a redirect to
  // it, or 401. Each means the same thing to the reader: a token is needed.
  // (A browser shows a redirect it was told not to follow as `opaqueredirect`;
  // elsewhere it is the 3xx itself.)
  const signIn = response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)
    || response.status === 401 || response.status === 203
    || (response.ok && !isJson(response));
  if (signIn) {
    return new ViewerError(withToken ? 'web.error.badToken' : 'web.error.signIn', { what }, undefined, true);
  }
  // GitHub, GitLab and Gitea answer 404 for a private repository, so that its
  // existence is not given away. With no token that is what it most likely is.
  if (response.status === 404 || response.status === 403) {
    return new ViewerError(withToken ? 'web.error.notFoundToken' : 'web.error.notFound', { what }, undefined, true);
  }
  return new ViewerError('web.error.http', { status: String(response.status), url });
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

/**
 * Splits `rest` (a ref and a path run together) where the ref ends. A branch
 * may be called `claude/x`, so this cannot be done by looking: the longest
 * named ref wins, as the hosts themselves decide. `named` is one page of
 * branches and tags; `lookup` asks about one candidate, for repositories with
 * more than a page of them, shortest first since most refs have no `/`.
 */
export async function splitRef(
  rest: readonly string[], named: () => Promise<readonly { name: string; sha: string }[]>,
  lookup: (ref: string) => Promise<string | undefined>,
): Promise<{ ref: string; sha: string; used: number }> {
  const joined = rest.join('/');
  if (SHA.test(rest[0] ?? '')) return { ref: rest[0]!, sha: rest[0]!.toLowerCase(), used: 1 };
  const refs = await named();
  const best = longestRef(joined, refs.map(one => one.name));
  if (best !== undefined) {
    return { ref: best, sha: refs.find(one => one.name === best)!.sha, used: best.split('/').length };
  }
  for (let used = 1; used <= Math.min(rest.length, 5); used++) {
    const ref = rest.slice(0, used).join('/');
    const sha = await lookup(ref).catch(error => {
      if (error instanceof ViewerError && error.wantsToken) return undefined;
      throw error;
    });
    if (sha !== undefined) return { ref, sha, used };
  }
  throw new ViewerError('web.error.ref', { path: joined });
}

export const SHA = /^[0-9a-f]{40}$/i;

/** A path for a URL: each segment encoded, the slashes kept. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp',
};

/** A picture's bytes as a `data:` URL, typed by its extension. */
export function dataUrl(path: string, bytes: Uint8Array): string {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  return `data:${IMAGE_TYPES[extension] ?? 'application/octet-stream'};base64,${base64(bytes)}`;
}

export function base64(bytes: Uint8Array): string {
  let binary = '';
  // In slices: one call per byte is slow, one call for all of them overflows.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodeText(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}
