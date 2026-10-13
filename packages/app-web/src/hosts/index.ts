// Which host an address is on, told from the address alone.
//
// No configuration is needed: each host shapes its addresses its own way —
// `_git` for Azure DevOps, `/-/` for GitLab, `src/branch|tag|commit` for Gitea
// and Forgejo, `blob|tree` for GitHub (and, on any other server, GitHub
// Enterprise). A server's bare `owner/repo` could be any of them, so it is
// taken only where the host is known.

import { Azure, parseAzure } from './azure.js';
import type { Host, HostContext } from './base.js';
import { Gitea, parseGitea } from './gitea.js';
import { GitHub, parseGitHub } from './github.js';
import { GitLab, parseGitLab } from './gitlab.js';

export * from './base.js';
export { Azure, parseAzure, type AzureAddress } from './azure.js';
export { Gitea, parseGitea, type GiteaAddress } from './gitea.js';
export { GitHub, githubUrl, parseGitHub, type GitHubAddress } from './github.js';
export { GitLab, parseGitLab, type GitLabAddress } from './gitlab.js';

/** An address the page can read, waiting for its token to be decided. */
export interface Addressed {
  /** Where the token for it is kept. */
  readonly origin: string;
  /** The host, opened with the token for its origin (or none). */
  open(context: HostContext): Host;
}

/** Tells the host from the address. Undefined when it is not one this page can show. */
export function addressOf(text: string): Addressed | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  // A server inside a network may be on plain http; the page reads it, but
  // never sends it a token (see tokens.ts).
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') return undefined;
  const segments = url.pathname.split('/').filter(segment => segment !== '').map(decode);

  const azure = parseAzure(url, segments);
  if (azure) return { origin: azure.base, open: context => new Azure(azure, context) };
  const gitlab = parseGitLab(url, segments);
  if (gitlab) return { origin: gitlab.origin, open: context => new GitLab(gitlab, context) };
  const gitea = parseGitea(url, segments);
  if (gitea) return { origin: gitea.origin, open: context => new Gitea(gitea, context) };
  const github = parseGitHub(url, segments);
  if (github) return { origin: github.origin, open: context => new GitHub(github, context) };
  return undefined;
}

function decode(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}
