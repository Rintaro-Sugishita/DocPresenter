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
  };

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
  /** Show the text, beside the canvas. */
  | { readonly kind: 'source' }
  | { readonly kind: 'error'; readonly message: string };
