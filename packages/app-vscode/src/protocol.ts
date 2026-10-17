// What the two halves of the extension say to each other.
//
// The editor runs in a WebView and the files live in the workspace, so every
// edit crosses a postMessage boundary. Both halves import this file, which is
// the whole of the contract: a message that is not here cannot be sent.
//
// The direction is in the name. `ToView` is the host telling the editor what
// the workspace holds; `FromView` is the editor saying what the author did.

import type { ByteSpan, Locale } from '@docpresenter/base';
import type { CommitKey } from '@docpresenter/editor';
import type { PagePlan } from '@docpresenter/pdf';

/** What the export buttons write. */
export type ExportFormat = 'html' | 'pdf' | 'pptx';

/** A Mermaid drawing as a picture: a PNG data URL and its size in pixels. */
export interface Picture {
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

/** A review comment made on the open document, as the screen is sent it. */
export interface ReviewNoteMessage {
  readonly key: string;
  readonly round: string;
  readonly id: number;
  readonly file?: string;
  readonly start?: number;
  readonly end?: number;
  readonly quote?: string;
  /** The anchored file at the commit the comment was made on, read as LF. */
  readonly before?: string;
  readonly body: string;
  readonly status: string;
  readonly reply?: string;
  readonly author?: string;
  readonly date?: string;
  readonly replies: readonly { readonly body: string; readonly author?: string }[];
}

/** Host → WebView. */
export type ToView =
  | {
    readonly kind: 'open';
    /** The document being edited, as the workspace sees it. */
    readonly path: string;
    readonly source: string;
    /** Every text file the document could refer to, by workspace path. */
    readonly files: Readonly<Record<string, string>>;
    /** Pictures, by workspace path, as URLs the WebView may load. */
    readonly images: Readonly<Record<string, string>>;
    readonly commitKey: CommitKey;
    /** VS Code's display language, so the editor speaks the same one as the host. */
    readonly locale: Locale;
  }
  /** Somebody else changed a file — the document itself, or one it refers to. */
  | { readonly kind: 'file'; readonly path: string; readonly text: string }
  | { readonly kind: 'image'; readonly path: string; readonly url: string }
  | { readonly kind: 'settings'; readonly commitKey: CommitKey }
  /**
   * The workspace's own theme for the document on screen, in place of the one
   * the extension ships — sent on opening and whenever it is saved. Absent
   * when the workspace has none.
   */
  | { readonly kind: 'theme'; readonly css?: string }
  /**
   * Lay this page out and measure it for a PDF. Only a browser can, and the
   * WebView is the one the extension has; the host writes the PDF from the
   * plan that comes back. `body` is the page's body, theme already loaded.
   */
  | {
    readonly kind: 'measure'; readonly id: number;
    readonly body: string; readonly foot: string; readonly title: string;
    /** The theme to lay it out in, in place of the one the WebView has loaded. */
    readonly style?: string;
    /** The language of the diagnostics that come back. */
    readonly locale: Locale;
  }
  /** Draw one Mermaid source as a picture, for a slide. */
  | { readonly kind: 'picture'; readonly id: number; readonly source: string }
  /** The review comments on this document, sent on opening and whenever a review file changes. */
  | { readonly kind: 'reviews'; readonly notes: readonly ReviewNoteMessage[] }
  /** Where an export stands, for the buttons to show. */
  | { readonly kind: 'export-state'; readonly busy: boolean; readonly message?: string };

/** WebView → host. */
export type FromView =
  | { readonly kind: 'ready' }
  /**
   * One edit. `path` is absent for the document itself and workspace-relative
   * otherwise; `span` is the byte range in the text as it was before, which is
   * what the host rewrites — the whole point of the format.
   *
   * The range and the text are those of the file with its line breaks read as
   * LF, whatever the file has on disk: a range has to mean the same on a CRLF
   * checkout as on an LF one, because a review comment is anchored to one
   * (design/review-model.md §3). The host restates it for the file
   * (`spanInFile`), CRLF and all.
   */
  | {
    readonly kind: 'change';
    readonly path?: string;
    readonly span: ByteSpan;
    readonly description: string;
    readonly text: string;
  }
  /** A new file behind a figure, a table, or a picture that was pasted in. */
  | {
    readonly kind: 'create';
    readonly path: string;
    readonly text?: string;
    /** A picture's bytes, as plain numbers: a WebView message is JSON. */
    readonly bytes?: readonly number[];
  }
  /**
   * Rename a figure's file, both as workspace paths. The host moves the file
   * and points every other document's `@import` at it; the document on screen
   * is rewritten by the editor, with a `change` that follows this message.
   */
  | { readonly kind: 'move'; readonly from: string; readonly to: string }
  | { readonly kind: 'error'; readonly message: string }
  /** A review comment made in the review mode, on a selection of the document. */
  | {
    readonly kind: 'review-add';
    readonly anchor: { readonly file: string; readonly start: number; readonly end: number; readonly quote: string };
    readonly precision: 'text' | 'block' | 'none';
    readonly body: string;
  }
  /** The state of a review comment, or the answer to it, set in the review panel. */
  | {
    readonly kind: 'review-update';
    readonly round: string;
    readonly id: number;
    readonly status?: string;
    readonly reply?: string;
  }
  /** The author pressed an export button. */
  | { readonly kind: 'export'; readonly format: ExportFormat }
  | {
    readonly kind: 'measured'; readonly id: number;
    readonly plan?: PagePlan; readonly diagnostics?: readonly string[]; readonly error?: string;
  }
  | { readonly kind: 'pictured'; readonly id: number; readonly picture?: Picture; readonly error?: string };
