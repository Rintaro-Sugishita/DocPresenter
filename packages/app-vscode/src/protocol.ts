// What the two halves of the extension say to each other.
//
// The editor runs in a WebView and the files live in the workspace, so every
// edit crosses a postMessage boundary. Both halves import this file, which is
// the whole of the contract: a message that is not here cannot be sent.
//
// The direction is in the name. `ToView` is the host telling the editor what
// the workspace holds; `FromView` is the editor saying what the author did.

import type { ByteSpan } from '@docpresenter/base';
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
    /**
     * A `.dgm` opened on its own. `source` is then a one-line document that
     * takes the drawing in, and exists only on screen: edits to it are not sent.
     */
    readonly diagram?: boolean;
  }
  /** Somebody else changed a file — the document itself, or one it refers to. */
  | { readonly kind: 'file'; readonly path: string; readonly text: string }
  | { readonly kind: 'image'; readonly path: string; readonly url: string }
  | { readonly kind: 'settings'; readonly commitKey: CommitKey }
  /**
   * Lay this page out and measure it for a PDF. Only a browser can, and the
   * WebView is the one the extension has; the host writes the PDF from the
   * plan that comes back. `body` is the page's body, theme already loaded.
   */
  | {
    readonly kind: 'measure'; readonly id: number;
    readonly body: string; readonly foot: string; readonly title: string;
  }
  /** Draw one Mermaid source as a picture, for a slide. */
  | { readonly kind: 'picture'; readonly id: number; readonly source: string }
  /** Where an export stands, for the buttons to show. */
  | { readonly kind: 'export-state'; readonly busy: boolean; readonly message?: string };

/** WebView → host. */
export type FromView =
  | { readonly kind: 'ready' }
  /**
   * One edit. `path` is absent for the document itself and workspace-relative
   * otherwise; `span` is the byte range in the text as it was before, which is
   * what the host rewrites — the whole point of the format.
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
  | { readonly kind: 'error'; readonly message: string }
  /** The author pressed an export button. */
  | { readonly kind: 'export'; readonly format: ExportFormat }
  | {
    readonly kind: 'measured'; readonly id: number;
    readonly plan?: PagePlan; readonly diagnostics?: readonly string[]; readonly error?: string;
  }
  | { readonly kind: 'pictured'; readonly id: number; readonly picture?: Picture; readonly error?: string };
