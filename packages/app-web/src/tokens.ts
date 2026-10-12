// The reader's access tokens, kept in this tab only.
//
// A token is the reader's own key to a private repository. It is kept in
// sessionStorage — gone when the tab is closed, and never in localStorage,
// which every page of the same github.io site could read — and it is sent to
// the origin it was given for and nowhere else. Never over plain http: a
// token on the wire in the clear is a token given away.

/** Where tokens are kept: sessionStorage in a browser, a map in a test. */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'docpresenter.token:';

export class Tokens {
  constructor(private readonly storage: TokenStorage | undefined) {}

  /** The browser's sessionStorage, or nothing when it will not give it. */
  static of(win: Window): Tokens {
    try {
      return new Tokens(win.sessionStorage ?? undefined);
    } catch {
      return new Tokens(undefined);
    }
  }

  /** Whether a token may be sent to this origin at all. */
  static allowed(origin: string): boolean {
    return origin.startsWith('https://');
  }

  get(origin: string): string | undefined {
    if (!Tokens.allowed(origin)) return undefined;
    try {
      return this.storage?.getItem(PREFIX + origin) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Keeps a token for this tab. False when it could not be kept (it is then used once). */
  set(origin: string, token: string): boolean {
    if (!Tokens.allowed(origin)) return false;
    try {
      this.storage?.setItem(PREFIX + origin, token.trim());
      return this.storage !== undefined;
    } catch {
      return false;
    }
  }

  forget(origin: string): void {
    try { this.storage?.removeItem(PREFIX + origin); } catch { /* nothing kept, nothing to forget */ }
  }
}
