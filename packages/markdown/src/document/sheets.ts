// Splits a document into sheets. A sheet is nothing but the span between two
// `---` separators: the editor shows one at a time, the PDF starts a page at
// each boundary and the PPTX starts a slide. No new notation, and no name
// stored anywhere — the tab's name is read off the first heading inside.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import type { ResolvedDocument } from '../numbering/model.js';
import { MARKDOWN_MESSAGES } from '../messages.js';
import type { Block, ByteSpan, DocumentFile } from './model.js';
import { parseDocument } from './parse.js';

export interface Sheet {
  /** 1-based, in source order. */
  readonly index: number;
  /** For the tab. Computed, never stored. */
  readonly title: string;
  readonly blocks: readonly Block[];
  /** From the first block to the last, excluding the separators themselves. */
  readonly span: ByteSpan;
}

/**
 * `resolved` is optional: with it the tab of a numbered heading reads
 * "3. 認証方式" rather than "認証方式", which is what the reader will see.
 */
export function sheetsOf(
  document: DocumentFile, resolved?: ResolvedDocument, locale: Locale = resolved?.locale ?? DEFAULT_LOCALE,
): readonly Sheet[] {
  // Every separator makes a boundary, including a trailing one: `at` is where
  // an empty sheet sits. Trimming empty sheets away seems tidy until you press
  // "add sheet" and nothing appears, or delete a sheet's last line and its tab
  // vanishes. A stray `---` at the end of a file is better shown as an empty
  // tab the author can delete than silently ignored.
  const groups: { blocks: Block[]; at: number }[] = [{ blocks: [], at: 0 }];
  for (const block of document.blocks) {
    if (block.kind === 'separator') groups.push({ blocks: [], at: block.span.end });
    else groups[groups.length - 1]!.blocks.push(block);
  }

  return groups.map(({ blocks, at }, i) => ({
    index: i + 1,
    title: titleOf(blocks, i + 1, resolved, locale),
    blocks,
    span: blocks.length === 0
      ? { start: at, end: at }
      : { start: blocks[0]!.span.start, end: blocks[blocks.length - 1]!.span.end },
  }));
}

/**
 * The heading a sheet borrows from the document it takes in, when it has none
 * of its own: a sheet that is only `@import "revision.md"` is named by the
 * `## 改訂履歴` in that file. `read` gets the file as the sheet's document
 * writes its path; the heading's span is in that file.
 */
export function importedHeadingOf(
  blocks: readonly Block[], read: (path: string) => string | undefined,
): { path: string; heading: Extract<Block, { kind: 'heading' }> } | undefined {
  if (blocks.some(block => block.kind === 'heading')) return undefined;
  for (const block of blocks) {
    if (block.kind !== 'import' || !/\.md$/i.test(block.path)) continue;
    const source = read(block.path);
    if (source === undefined) continue;
    try {
      const heading = parseDocument(source).blocks.find(one => one.kind === 'heading');
      if (heading && heading.kind === 'heading') return { path: block.path, heading };
    } catch { /* 読めない文書は名前を貸さない */ }
  }
  return undefined;
}

function titleOf(
  blocks: readonly Block[], index: number, resolved: ResolvedDocument | undefined, locale: Locale,
): string {
  const heading = blocks.find(block => block.kind === 'heading');
  if (!heading || heading.kind !== 'heading') return MARKDOWN_MESSAGES.in(locale)('markdown.untitledSheet', { index });
  const numbered = resolved?.elements.find(element => element.block === heading);
  return numbered?.number ? `${numbered.number} ${heading.text}` : heading.text;
}
