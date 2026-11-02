// Undo and redo.
//
// An edit is one byte range, and so is taking it back. A step remembers the
// whole text of the file before and after, but what is written to undo it is
// the smallest range in which the two differ — the same promise every other
// edit keeps, so the host writes it, VS Code records it and a diff shows it
// exactly as it would show any edit.
//
// A step is only taken back from the text it left behind. If the file has
// changed since — another editor, a checkout, a formatter — writing the old
// text back would throw that change away without a word, so the history says
// so and forgets itself instead (P6).

import { byteLength, type ByteSpan } from '@docpresenter/base';

export interface Step {
  /** The referenced file it was made in; undefined for the document itself. */
  readonly path: string | undefined;
  readonly before: string;
  readonly after: string;
  /** What was done, in the author's language, for "Undo: …". */
  readonly description: string;
  /** The sheet that was on screen, so taking it back shows where it happened. */
  readonly sheet: number;
  /**
   * Another file the same gesture changed — a screen's item table, when a
   * label was renamed on the screen. Taken back and made again with it.
   */
  readonly also?: { readonly path: string | undefined; readonly before: string; readonly after: string } | undefined;
}

export interface History {
  /** Remembers a step that was just made. Anything that was undone is gone. */
  record(step: Step): void;
  /** The step an undo would take back. */
  nextUndo(): Step | undefined;
  /** The step a redo would make again. */
  nextRedo(): Step | undefined;
  /** Moves the step `nextUndo` returned over to the redo side. */
  undone(): void;
  /** Moves the step `nextRedo` returned back to the undo side. */
  redone(): void;
  clear(): void;
}

/**
 * How far back the history goes. Each step holds two copies of a file; a few
 * hundred design documents' worth is nothing, and nobody undoes further.
 */
const LIMIT = 200;

export function createHistory(limit = LIMIT): History {
  const done: Step[] = [];
  const undone: Step[] = [];
  return {
    record(step) {
      if (step.before === step.after) return;
      done.push(step);
      if (done.length > limit) done.shift();
      undone.length = 0;
    },
    nextUndo: () => done[done.length - 1],
    nextRedo: () => undone[undone.length - 1],
    undone() {
      const step = done.pop();
      if (step) undone.push(step);
    },
    redone() {
      const step = undone.pop();
      if (step) done.push(step);
    },
    clear() {
      done.length = 0;
      undone.length = 0;
    },
  };
}

/**
 * The one byte range that turns `from` into `to`: what the two share at the
 * start and at the end is left alone. Never splits a character, so the range
 * is one the rest of the product can measure.
 */
export function differingRange(from: string, to: string): { span: ByteSpan; text: string } {
  const shorter = Math.min(from.length, to.length);
  let head = 0;
  while (head < shorter && from[head] === to[head]) head += 1;
  // A pair of surrogates is one character. Stopping between them would cut it.
  if (head > 0 && isHighSurrogate(from.charCodeAt(head - 1))) head -= 1;
  let tail = 0;
  while (tail < shorter - head && from[from.length - 1 - tail] === to[to.length - 1 - tail]) tail += 1;
  if (tail > 0 && isLowSurrogate(from.charCodeAt(from.length - tail))) tail -= 1;
  const start = byteLength(from.slice(0, head));
  const end = byteLength(from.slice(0, from.length - tail));
  return { span: { start, end }, text: to.slice(head, to.length - tail) };
}

/**
 * The edit that takes a step back, if the file is still as the step left it.
 * Undefined means it is not: something else has written to it since.
 */
export function undoing(step: Step, current: string | undefined): { span: ByteSpan; text: string } | undefined {
  return current === step.after ? differingRange(step.after, step.before) : undefined;
}

/** The edit that makes a step again, if the file is still as the undo left it. */
export function redoing(step: Step, current: string | undefined): { span: ByteSpan; text: string } | undefined {
  return current === step.before ? differingRange(step.before, step.after) : undefined;
}

/** Whether a key press asks to undo or redo. Cmd on macOS, Ctrl elsewhere. */
export function undoKey(event: {
  readonly key: string; readonly ctrlKey: boolean; readonly metaKey: boolean;
  readonly shiftKey: boolean; readonly altKey: boolean;
}): 'undo' | 'redo' | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return undefined;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
