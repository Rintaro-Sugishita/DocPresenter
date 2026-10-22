// What is wrong with a drawing, without drawing it anywhere.
//
// The build's check and the drawing's own command line both ask this, and the
// drawing side has to be able to answer it alone — it is installed without the
// document side.

import { describeError, phraseOf, say, type Locale, type Phrase } from '@docpresenter/base';
import { layOutDiagram } from './layout.js';
import { parseDiagram } from './parse.js';
import { withParts, type PartReader } from './parts.js';

export interface DrawingProblem {
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly id?: string;
  /** Bytes of the source read as LF. */
  readonly span?: { readonly start: number; readonly end: number };
  /** 1-based, when the problem is a line rather than a range. */
  readonly line?: number;
}

/**
 * Quiet: a shape not yet placed in a free drawing is the normal state of one
 * just written — the screen parks it below, waiting to be dragged.
 */
const QUIET = new Set(['diagram.layout.unplaced']);

/** A drawing's problems: the line that stops it being read, or what its layout could not do. */
export function drawingProblems(source: string, read: PartReader, locale: Locale): DrawingProblem[] {
  let file;
  try {
    file = withParts(parseDiagram(source), read);
  } catch (error) {
    return [unreadableProblem(error, locale)];
  }
  // A library holds no drawing, and an overlay's markers are pinned to an
  // image rather than laid out: neither has a layout to report on.
  if (file.mode === 'parts' || file.mode === 'overlay') return [];
  return layOutDiagram(file, locale).notes.map(note => ({
    severity: QUIET.has(note.id) ? 'info' : 'warning',
    message: note.message, id: note.id,
    ...(note.span === undefined ? {} : { span: note.span }),
  }));
}

/**
 * A file that could not be read, on the line that stopped it. The message
 * loses its "line N:" — whatever shows the problem shows the line already.
 */
export function unreadableProblem(error: unknown, locale: Locale): DrawingProblem {
  const phrase = phraseOf(error);
  const inner = phrase?.id === 'base.atLine' ? phrase.params?.['message'] : undefined;
  const line = (error as { line?: unknown }).line;
  return {
    severity: 'error',
    message: typeof inner === 'object' && inner !== null && 'id' in inner
      ? say(locale, inner as Phrase) : describeError(error, locale),
    ...(phrase === undefined ? {} : { id: phrase.id }),
    ...(typeof line === 'number' ? { line } : {}),
  };
}
