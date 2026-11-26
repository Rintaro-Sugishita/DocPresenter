// What the text cursor is on, as something the canvas can pick.
//
// A drawing is edited in two places at once — the text and the canvas — and
// the canvas follows the cursor: the line under it is a shape's, a
// connection's, a container's, so that is what is shown picked. A stack whose
// members cover it is picked this way too, which is the one way to see it.

import type { ByteSpan } from '@docpresenter/base';
import type { DiagramFile } from './model.js';

/** A shape or a connection named by a line of the text, by its byte offset. */
export type SourcePick =
  | { readonly kind: 'shape'; readonly id: string }
  | { readonly kind: 'edge'; readonly name: string };

/**
 * What the line at `offset` (a byte offset into the LF text) is about, or
 * undefined for a line about nothing in particular — a blank, a brace, `use`.
 * The narrowest line wins: a member's name inside a group block is the member.
 */
export function pickAt(file: DiagramFile, offset: number): SourcePick | undefined {
  let best: { pick: SourcePick; size: number } | undefined;
  const consider = (span: ByteSpan | undefined, pick: SourcePick): void => {
    if (!span || offset < span.start || offset > span.end) return;
    const size = span.end - span.start;
    if (!best || size < best.size) best = { pick, size };
  };
  for (const node of file.nodes) consider(node.span, { kind: 'shape', id: node.id });
  for (const edge of file.edges) consider(edge.span, { kind: 'edge', name: `${edge.from}->${edge.to}` });
  for (const [name, bend] of file.bends) consider(bend.span, { kind: 'edge', name });
  for (const container of file.containers.values()) consider(container.span, { kind: 'shape', id: container.id });
  for (const [id, pin] of file.layout) consider(pin.span, { kind: 'shape', id });
  for (const [id, sized] of file.sizes ?? []) consider(sized.span, { kind: 'shape', id });
  for (const [id, span] of file.styleSpans) consider(span, { kind: 'shape', id });
  const found = best as { pick: SourcePick } | undefined;
  if (!found) return undefined;
  // A name written inside a group's or a container's block is the shape named.
  const pick = found.pick;
  if (pick.kind === 'shape' && (file.containers.has(pick.id) || file.nodes.find(one => one.id === pick.id)?.shape === 'group')) {
    const word = wordAt(file, offset);
    if (word !== undefined && word !== pick.id && file.nodes.some(one => one.id === word)) return { kind: 'shape', id: word };
  }
  return pick;
}

/** The text the spans were read from, kept for `wordAt`. */
const TEXTS = new WeakMap<DiagramFile, string>();

/** Lets `pickAt` read the word under the cursor in a block. */
export function rememberSource(file: DiagramFile, source: string): DiagramFile {
  TEXTS.set(file, source);
  return file;
}

function wordAt(file: DiagramFile, offset: number): string | undefined {
  const source = TEXTS.get(file);
  if (source === undefined) return undefined;
  const bytes = new TextEncoder().encode(source);
  const before = new TextDecoder().decode(bytes.slice(0, offset));
  const after = new TextDecoder().decode(bytes.slice(offset));
  const word = /[A-Za-z0-9_぀-鿿]*$/u.exec(before)?.[0] ?? '';
  const rest = /^[A-Za-z0-9_぀-鿿]*/u.exec(after)?.[0] ?? '';
  const whole = word + rest;
  return whole === '' ? undefined : whole;
}
