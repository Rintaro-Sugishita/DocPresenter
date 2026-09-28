// The document model. Every element carries the byte range it occupies in the
// source, because review comments anchor to byte ranges rather than to element
// identity, and every renderer has to emit a source map back to them.

// The range type itself is in the base package: every edit in this project is
// the replacement of one byte range, so it belongs under everything rather
// than inside the model that needed it first.
export type { ByteSpan } from '@docpresenter/base';
import type { ByteSpan } from '@docpresenter/base';

/** A reference to a label, written `@fig-x` or `@SD-002:sec-x`. */
export interface Reference {
  /** Document id for a cross-document reference, otherwise undefined. */
  readonly document: string | undefined;
  readonly label: string;
  readonly span: ByteSpan;
}

export interface Heading {
  readonly kind: 'heading';
  readonly level: number;
  readonly text: string;
  readonly label: string | undefined;
  readonly references: readonly Reference[];
  readonly span: ByteSpan;
}

/** `@import "path" {attr}` — an embedded object held in its own file. */
export interface Import {
  readonly kind: 'import';
  readonly path: string;
  readonly label: string | undefined;
  readonly attributes: ReadonlyMap<string, string>;
  readonly span: ByteSpan;
}

/** `---` — a page break in PDF and a slide split in PPTX. Never a rule. */
export interface Separator {
  readonly kind: 'separator';
  readonly span: ByteSpan;
}

export interface Prose {
  readonly kind: 'prose';
  readonly text: string;
  readonly references: readonly Reference[];
  readonly span: ByteSpan;
}

export type Block = Heading | Import | Separator | Prose;

export interface Frontmatter {
  readonly raw: Readonly<Record<string, unknown>>;
  /** Output formats that make this document a build root. */
  readonly output: readonly string[];
  readonly theme: string | undefined;
  readonly span: ByteSpan | undefined;
}

export interface DocumentFile {
  readonly frontmatter: Frontmatter;
  readonly blocks: readonly Block[];
}

/** A document is a build root when it declares output formats. */
export function isBuildRoot(document: DocumentFile): boolean {
  return document.frontmatter.output.length > 0;
}
