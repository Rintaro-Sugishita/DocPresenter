// What the canvas and the extension host say to each other. Shared by both
// halves, and imports nothing: the screen must not carry VS Code, nor the host
// the screen.

/** Host → canvas. */
export type ToCanvas =
  | {
    /** `open` the first time, `update` when the text changed elsewhere. */
    readonly kind: 'open' | 'update';
    readonly source: string;
    /** The files the drawing's `use` lines reach, by the path written. */
    readonly libraries: Readonly<Record<string, string>>;
    /**
     * What this drawing's item table would be called, beside it. When a file of
     * that name is there already, it is in `libraries` under this name.
     */
    readonly itemTable: string;
    readonly locale: 'ja' | 'en';
    /** The shipped theme's text, which the dark screen's colours are made from. Sent with `open`. */
    readonly theme?: string;
    /** The pictures the drawing's shapes point at, as data URLs by the path written. */
    readonly pictures?: Readonly<Record<string, string>>;
    /** The repository's settings (`.docpresenter/settings.yml`), read. */
    readonly settings?: unknown;
  }
  /** The picture the author chose for a `pick-picture`, as the drawing writes its path; none when they did not. */
  | { readonly kind: 'picked'; readonly id: number; readonly path?: string; readonly url?: string }
  /**
   * Where the text cursor is in the drawing's text, as a byte offset into the
   * text last sent: the canvas picks what that line is about.
   */
  | { readonly kind: 'cursor'; readonly offset: number };

/** Canvas → host. */
export type FromCanvas =
  | { readonly kind: 'ready' }
  /**
   * One edit, as a byte range of the source the canvas was drawing — or, with
   * `path`, of the file the drawing names (its item table), as written in it.
   */
  | {
    readonly kind: 'edit'; readonly start: number; readonly end: number; readonly text: string;
    readonly base: string; readonly path?: string;
  }
  /** Make a file beside the drawing (its item table), unless one is there. */
  | { readonly kind: 'create'; readonly path: string; readonly text: string }
  /** Ask the author for a picture; answered with `picked` under the same id. */
  | { readonly kind: 'pick-picture'; readonly id: number }
  /** Show the text, beside the canvas. */
  | { readonly kind: 'source' }
  /** Open a file the drawing names (its item table) as text, beside the canvas. */
  | { readonly kind: 'open-file'; readonly path: string }
  | { readonly kind: 'error'; readonly message: string };
