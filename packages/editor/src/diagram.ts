// Editing a diagram's layout layer. Dragging a shape writes one pin, which is
// one line, which is one byte range: the semantics section is never touched by
// a move, so a diff of a moved shape is a diff of a coordinate and nothing
// else. Un-pinning is just as important as pinning — a layer that only ever
// grows is a layout nobody can hand back to the engine.

import { byteLength, sliceBytes, type DiagramFile } from '@docpresenter/core';
import type { Edit } from './edit.js';

export class DiagramEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagramEditError';
  }
}

/** Where a shape sits, as the file records it. Sizes are optional as ever. */
export interface Pin {
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly z?: number | undefined;
}

/**
 * Pins a shape where it now sits. An existing pin is rewritten in place, so the
 * line keeps the alignment the author gave it; a shape with none gains one line
 * at the end of the layout block.
 */
export function pinNode(file: DiagramFile, source: string, id: string, pin: Pin): Edit {
  if (!file.nodes.some(node => node.id === id)) {
    throw new DiagramEditError(`図形が見つからない: ${id}`);
  }
  const existing = file.layout.get(id);
  if (existing) {
    const like = sliceBytes(source, existing.span.start, existing.span.end);
    // Moving a shape moves it. A size or a depth the author set stays set.
    const merged: Pin = {
      x: pin.x, y: pin.y,
      width: pin.width ?? existing.width,
      height: pin.height ?? existing.height,
      z: pin.z ?? existing.z,
    };
    return { span: existing.span, text: formatPlacement(id, merged, like), description: '配置を変更' };
  }

  const line = formatPlacement(id, pin, undefined, width(file));
  if (file.layoutBlock) {
    const { insertAt, indent } = file.layoutBlock;
    return {
      span: { start: insertAt, end: insertAt },
      text: `\n${indent}${line}`,
      description: '配置を固定',
    };
  }
  // No layout block yet: start one after everything else in the file.
  const end = byteLength(source.replace(/\s+$/, ''));
  return {
    span: { start: end, end: byteLength(source) },
    text: `\n\nlayout {\n  ${line}\n}\n`,
    description: '配置を固定',
  };
}

/** Hands a shape back to the layout engine by removing its line. */
export function unpinNode(file: DiagramFile, source: string, id: string): Edit {
  const existing = file.layout.get(id);
  if (!existing) throw new DiagramEditError(`${id} は自動配置のまま`);
  // The span starts after the indent, so take the indent with it: leaving it
  // behind would push the next line sideways.
  const before = sliceBytes(source, 0, existing.span.start);
  const indent = /[ \t]*$/.exec(before)?.[0] ?? '';
  return {
    span: {
      start: existing.span.start - indent.length,
      end: Math.min(existing.span.end + 1, byteLength(source)),
    },
    text: '',
    description: '配置を自動に戻す',
  };
}

/** Where a callout's marker sits and what it points at, in image pixels. */
export interface CalloutAt {
  readonly x: number;
  readonly y: number;
  readonly targetX: number;
  readonly targetY: number;
}

/** Moves one callout. The wording is not touched, only the two points. */
export function moveCallout(
  file: DiagramFile, source: string, marker: string, to: CalloutAt,
): Edit {
  const callout = file.callouts.find(c => c.marker === marker);
  if (!callout) throw new DiagramEditError(`注釈が見つからない: ${marker}`);
  const like = sliceBytes(source, callout.span.start, callout.span.end);
  const text = `${padTo(marker, markerWidth(file))}@ (${round(to.x)}, ${round(to.y)})`
    + ` -> (${round(to.targetX)}, ${round(to.targetY)})`
    + (callout.text === '' ? '' : `  "${callout.text}"`);
  return {
    span: callout.span,
    text: keepColumns(text, like),
    description: '注釈を移動',
  };
}

/**
 * One pin as a line. `like` is the line being replaced: its spacing is copied
 * so that a hand-aligned layout block stays aligned after a drag.
 */
export function formatPlacement(
  id: string, pin: Pin, like?: string, idWidth?: number,
): string {
  const size = pin.width !== undefined && pin.height !== undefined
    ? ` ${round(pin.width)}x${round(pin.height)}` : '';
  const z = pin.z !== undefined ? `  z:${pin.z}` : '';
  const text = `${padTo(id, idWidth ?? id.length + 1)}@ (${round(pin.x)}, ${round(pin.y)})${size}${z}`;
  return like === undefined ? text : keepColumns(text, like);
}

/**
 * Rewrites the new line with the old one's columns: the name is padded to the
 * same width and each number is right-aligned in the field it had. Only spacing
 * is taken from the old line, never a value.
 */
function keepColumns(text: string, like: string): string {
  const name = /^(\S+\s*)(?=@)/.exec(like)?.[1];
  let out = name === undefined ? text : text.replace(/^\S+\s*(?=@)/, m => padTo(m.trim(), name.length));

  const fields = numberFields(like);
  if (fields.length === 0) return out;
  const original = out;
  let index = 0;
  // The generated line already carries one space after each comma, so the
  // whole space-and-number run is what gets widened to the old field.
  return original.replace(/(\s*)(-?\d+)/g, (whole, spaces: string, _number: string, offset: number) => {
    if (!inColumn(original, offset + spaces.length)) return whole;
    const field = fields[index++];
    if (field === undefined || whole.length >= field) return whole;
    return ' '.repeat(field - whole.length) + whole;
  });
}

/** The width each number occupies in a line, counting the spaces before it. */
function numberFields(like: string): readonly number[] {
  return [...like.matchAll(/(\s*)(-?\d+)/g)]
    .filter(m => inColumn(like, m.index + m[1]!.length))
    .map(m => m[1]!.length + m[2]!.length);
}

/**
 * True when a number stands in a column of its own. The height in `380x330` and
 * the depth in `z:-1` follow something else, so padding them would only push
 * the line about.
 */
function inColumn(line: string, at: number): boolean {
  return !/[A-Za-z:]$/.test(line.slice(0, at));
}

/** The width the names occupy in the layout block, so a new line lines up. */
function width(file: DiagramFile): number {
  let widest = 0;
  for (const id of file.layout.keys()) widest = Math.max(widest, id.length);
  return widest + 1;
}

function markerWidth(file: DiagramFile): number {
  let widest = 0;
  for (const callout of file.callouts) widest = Math.max(widest, callout.marker.length);
  return widest + 1;
}

function padTo(text: string, width: number): string {
  return text + ' '.repeat(Math.max(1, width - text.length));
}

/** Coordinates are whole numbers. Nobody drags a shape by half a pixel. */
function round(value: number): number {
  return Math.round(value);
}
