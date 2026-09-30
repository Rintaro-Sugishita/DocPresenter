// The document's headings, in reading order.
//
// A table of contents, a PDF's bookmarks and the tab strip all want the same
// answer — what the sections are and what they are called — and none of them
// should work it out from rendered HTML. Imports are already folded into the
// block list by expansion, so a section that lives in another file is here too,
// numbered as the reader will see it.

import type { NumberedElement, ResolvedDocument } from '../numbering/model.js';
import type { DocumentFile } from './model.js';

export interface SectionHeading {
  /** 1 for `#`, 2 for `##`, and so on. */
  readonly level: number;
  /** `3.1`, or undefined when the heading is not numbered. */
  readonly number: string | undefined;
  /** The heading as written, without its number. */
  readonly text: string;
  /** The anchor a reference or a table of contents links to. */
  readonly id: string | undefined;
}

export function headingsOf(document: DocumentFile, resolved?: ResolvedDocument): readonly SectionHeading[] {
  const numbered = new Map<unknown, NumberedElement>(
    (resolved?.elements ?? []).map(element => [element.block, element]),
  );
  const found: SectionHeading[] = [];
  for (const block of document.blocks) {
    if (block.kind !== 'heading') continue;
    found.push({
      level: block.level,
      number: numbered.get(block)?.number,
      text: block.text,
      id: block.label,
    });
  }
  return found;
}
