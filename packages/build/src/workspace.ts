// What a build needs from the outside world.
//
// The package never touches a filesystem. A build runs in Node from a CLI, in
// a browser over a directory handle, and in a test over a map held in memory;
// all three can answer these four questions, and none of them belongs in here.

export interface Workspace {
  /** Every file in the workspace, as paths relative to its root. */
  list(): readonly string[];
  /** Reads a text file, or undefined when it is not there. */
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

export type Severity = 'error' | 'warning';

/**
 * Something the build has to say. Unlike a parse diagnostic it names a file,
 * because a build spans several.
 */
export interface BuildDiagnostic {
  readonly severity: Severity;
  readonly message: string;
  readonly path: string;
  readonly span?: { readonly start: number; readonly end: number };
}

export function hasError(diagnostics: readonly BuildDiagnostic[]): boolean {
  return diagnostics.some(d => d.severity === 'error');
}
