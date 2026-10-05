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
  }
  /** Somebody else changed a file — the document itself, or one it refers to. */
  | { readonly kind: 'file'; readonly path: string; readonly text: string }
  | { readonly kind: 'image'; readonly path: string; readonly url: string }
  | { readonly kind: 'settings'; readonly commitKey: CommitKey };

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
  | { readonly kind: 'error'; readonly message: string };
