// Which shape a byte range of a drawing is about, and back.
//
// A comment on a shape is a comment on the line that declares it: a review
// anchor is a file, a byte range and the words there (design/review-model.md
// §3), and a shape's line is the range that is that shape. These turn one into
// the other, so the screen can put the comment beside the shape it is about.

import type { ByteSpan } from '@docpresenter/base';
import type { Node } from './model.js';
import { parseDiagram } from './parse.js';

/**
 * The shape whose line holds the range, or undefined when the range is about
 * no one shape — a connection, the style section, or more than one line.
 */
export function nodeAtSpan(source: string, start: number, end: number): string | undefined {
  let best: Node | undefined;
  for (const node of nodesOf(source)) {
    if (start < node.span.start || end > node.span.end) continue;
    if (!best || node.span.end - node.span.start < best.span.end - best.span.start) best = node;
  }
  return best?.id;
}

/** The line that declares the shape, or undefined when no line does. */
export function nodeSpan(source: string, id: string): ByteSpan | undefined {
  return nodesOf(source).find(node => node.id === id)?.span;
}

function nodesOf(source: string): readonly Node[] {
  try {
    return parseDiagram(source).nodes;
  } catch {
    return [];
  }
}
