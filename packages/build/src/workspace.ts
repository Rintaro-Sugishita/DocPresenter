// What a build needs from the outside world.
//
// The package never touches a filesystem. A build runs in Node from a CLI, in
// a browser over a directory handle, and in a test over a map held in memory;
// all three can answer these four questions, and none of them belongs in here.

import { toLf } from '@docpresenter/base';

export interface Workspace {
  /** Every file in the workspace, as paths relative to its root. */
  list(): readonly string[];
  /**
   * Reads a text file, or undefined when it is not there. As it is on disk:
   * the build reads it as LF itself (`asLf`).
   */
  read(path: string): string | undefined;
  /**
   * A `data:` URL for a binary such as an image. Only the caller knows whether
   * the output travels as one file or beside its assets, and base64 is not this
   * package's business either way.
   */
  dataUrl?(path: string): string | undefined;
  /**
   * Fetches a picture written as an `http(s)` address and returns it as a
   * `data:` URL, or undefined when it cannot be had.
   *
   * **A delivered artifact never reaches out.** A document may point at a
   * picture on the web, and the only way to honour that without the reader
   * needing a network is to fetch it once, here, while the build runs, and
   * carry the bytes in the output. Nothing is written to the workspace: the
   * document still says the address, and the next build fetches it again.
   *
   * A shell without the means (or the permission) leaves this out, and the
   * figure says the picture could not be taken in. Silence is not an option.
   */
  inline?(address: string): Promise<string | undefined>;
}

/** A finished file the build produces. Text or bytes — a PDF is not a string. */
export interface Artifact {
  /** Where it goes, relative to the workspace root. */
  readonly path: string;
  readonly text?: string;
  readonly bytes?: Uint8Array;
  /** Which root it came from, for the report. */
  readonly root: string;
  readonly format: string;
}

/**
 * The workspace with every text read as LF.
 *
 * Every byte range the build writes into an artifact — the HTML's source map,
 * the PDF's, a diff mark — is where a review comment will be anchored, and an
 * anchor is a commit and a byte range (design/review-model.md §3). The same
 * commit is LF on one machine and CRLF on another, so the ranges are measured
 * on the LF text, which is also what the repository holds. Wrapping twice is
 * harmless.
 */
export function asLf(workspace: Workspace): Workspace {
  if (LF.has(workspace)) return workspace;
  const read = (path: string): string | undefined => {
    const text = workspace.read(path);
    return text === undefined ? undefined : toLf(text);
  };
  const wrapped: Workspace = {
    list: () => workspace.list(),
    read,
    ...(workspace.dataUrl ? { dataUrl: (path: string) => workspace.dataUrl!(path) } : {}),
    ...(workspace.inline ? { inline: (address: string) => workspace.inline!(address) } : {}),
  };
  LF.add(wrapped);
  return wrapped;
}
const LF = new WeakSet<Workspace>();

/** `info` is said and nothing more: the normal state of something half done. */
export type Severity = 'error' | 'warning' | 'info';

/**
 * Something the build has to say. Unlike a parse diagnostic it names a file,
 * because a build spans several.
 */
export interface BuildDiagnostic {
  readonly severity: Severity;
  /** In the locale the build was given. */
  readonly message: string;
  /** Which message it is, for code that decides by what was said. */
  readonly id?: string;
  readonly path: string;
  readonly span?: { readonly start: number; readonly end: number };
  /** 1-based, for a file that could not be read at all and so has no range to give. */
  readonly line?: number;
}

export function hasError(diagnostics: readonly BuildDiagnostic[]): boolean {
  return diagnostics.some(d => d.severity === 'error');
}
