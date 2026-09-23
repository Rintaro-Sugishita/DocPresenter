// Splits a document into sheets. A sheet is nothing but the span between two
// `---` separators: the editor shows one at a time, the PDF starts a page at
// each boundary and the PPTX starts a slide. No new notation, and no name
// stored anywhere — the tab's name is read off the first heading inside.

import type { ResolvedDocument } from '../numbering/model.js';
import type { Block, ByteSpan, DocumentFile } from './model.js';

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
export function sheetsOf(document: DocumentFile, resolved?: ResolvedDocument): readonly Sheet[] {
  const groups: Block[][] = [[]];
  for (const block of document.blocks) {
    if (block.kind === 'separator') groups.push([]);
    else groups[groups.length - 1]!.push(block);
  }

  // A separator at the very start or end does not make an empty sheet.
  const filled = groups.filter(blocks => blocks.length > 0);
  return filled.map((blocks, i) => ({
    index: i + 1,
    title: titleOf(blocks, i + 1, resolved),
    blocks,
    span: {
      start: blocks[0]!.span.start,
      end: blocks[blocks.length - 1]!.span.end,
    },
  }));
}

function titleOf(blocks: readonly Block[], index: number, resolved?: ResolvedDocument): string {
  const heading = blocks.find(block => block.kind === 'heading');
  if (!heading || heading.kind !== 'heading') return `シート ${index}`;
  const numbered = resolved?.elements.find(element => element.block === heading);
  return numbered?.number ? `${numbered.number} ${heading.text}` : heading.text;
}
