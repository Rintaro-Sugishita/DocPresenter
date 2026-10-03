// Small pictures of the shapes, for the menu that adds one. They are not the
// renderer's drawing: an icon is 16 by 12 and says which shape this is, while
// the drawing has text in it and a size someone chose.

import type { ShapeKind } from '../model.js';

const OUTLINE = 'fill="none" stroke="currentColor" stroke-width="1.2"';

/** One shape as inline SVG, at the size of a line of text. */
export function shapeIcon(shape: ShapeKind): string {
  const body = ((): string => {
    switch (shape) {
      case 'rect': return `<rect x="1.5" y="2.5" width="15" height="11" ${OUTLINE}/>`;
      case 'round-rect': return `<rect x="1.5" y="2.5" width="15" height="11" rx="3" ${OUTLINE}/>`;
      case 'stadium': return `<rect x="1.5" y="2.5" width="15" height="11" rx="5.5" ${OUTLINE}/>`;
      case 'ellipse': return `<ellipse cx="9" cy="8" rx="7.5" ry="5.5" ${OUTLINE}/>`;
      case 'diamond':
        return `<polygon points="9,2.5 16.5,8 9,13.5 1.5,8" ${OUTLINE}/>`;
      case 'cylinder':
        return `<path d="M1.5 5 A7.5 2.5 0 0 1 16.5 5 L16.5 11 A7.5 2.5 0 0 1 1.5 11 Z" ${OUTLINE}/>`
          + `<path d="M1.5 5 A7.5 2.5 0 0 0 16.5 5" ${OUTLINE}/>`;
      case 'note':
        return `<path d="M1.5 2.5 L12 2.5 L16.5 7 L16.5 13.5 L1.5 13.5 Z" ${OUTLINE}/>`
          + `<path d="M12 2.5 L12 7 L16.5 7" ${OUTLINE}/>`;
      case 'text':
        return `<path d="M3 4.5 L15 4.5 M9 4.5 L9 12" ${OUTLINE}/>`;
      case 'group':
        return `<rect x="1.5" y="2.5" width="15" height="11" stroke-dasharray="2 1.5" ${OUTLINE}/>`;
      case 'parallelogram':
        return `<polygon points="4,2.5 16.5,2.5 14,13.5 1.5,13.5" ${OUTLINE}/>`;
      case 'hexagon':
        return `<polygon points="4,2.5 14,2.5 16.5,8 14,13.5 4,13.5 1.5,8" ${OUTLINE}/>`;
      case 'loop-start':
        return `<polygon points="4,2.5 14,2.5 16.5,13.5 1.5,13.5" ${OUTLINE}/>`;
      case 'loop-end':
        return `<polygon points="1.5,2.5 16.5,2.5 14,13.5 4,13.5" ${OUTLINE}/>`;
      case 'line':
        return `<path d="M1.5 8 L16.5 8" ${OUTLINE}/>`;
    }
  })();
  return `<svg viewBox="0 0 18 16" width="18" height="16" aria-hidden="true">${body}</svg>`;
}

/**
 * The look of a line: where it points, and how thick it is.
 *
 * Drawn rather than named because "終点" and "始点" read alike in a row of
 * buttons, while an arrow pointing right and one pointing left do not.
 */
export function lineIcon(kind: string): string {
  const stroke = (from: number, to: number, weight = 1.4): string =>
    `<path d="M${from} 8 L${to} 8" fill="none" stroke="currentColor" stroke-width="${weight}"/>`;
  const head = (at: number, towards: 1 | -1): string =>
    `<polygon points="${at},8 ${at - 5 * towards},10.6 ${at - 5 * towards},5.4"`
    + ` fill="currentColor"/>`;
  const body = ((): string => {
    switch (kind) {
      case 'arrow-none': return stroke(2, 16);
      case 'arrow-end': return stroke(2, 12) + head(16, 1);
      case 'arrow-start': return stroke(6, 16) + head(2, -1);
      case 'arrow-both': return stroke(6, 12) + head(16, 1) + head(2, -1);
      case 'weight-1': return stroke(2, 16, 1.2);
      case 'weight-2': return stroke(2, 16, 2.6);
      default: return stroke(2, 16, 4.4);
    }
  })();
  return `<svg viewBox="0 0 18 16" width="18" height="16" aria-hidden="true">${body}</svg>`;
}

/**
 * The operations on one row of a tree, a list or a menu.
 *
 * Drawn rather than named for the same reason the alignment row is: six short
 * words in a row read as a wall, six marks read as a set of choices.
 */
export function rowIcon(kind: string): string {
  const stroke = 'fill="none" stroke="currentColor" stroke-width="1.5"'
    + ' stroke-linejoin="round" stroke-linecap="round"';
  const body = ((): string => {
    switch (kind) {
      case 'add': return `<path d="M9 3.5 V12.5 M4.5 8 H13.5" ${stroke}/>`;
      case 'drop': return `<path d="M5 4 L13 12 M13 4 L5 12" ${stroke}/>`;
      case 'in': return `<path d="M3 4 H9 M3 8 H15 M3 12 H9" ${stroke}/>`
        + `<path d="M12 5.5 L15 8 L12 10.5" ${stroke}/>`;
      case 'out': return `<path d="M9 4 H15 M3 8 H15 M9 12 H15" ${stroke}/>`
        + `<path d="M6 5.5 L3 8 L6 10.5" ${stroke}/>`;
      case 'pick': return '<circle cx="9" cy="8" r="4" fill="currentColor"/>';
      default: return `<path d="M6.5 4 L11 8 L6.5 12" ${stroke}/>`;
    }
  })();
  return `<svg viewBox="0 0 18 16" width="18" height="16" aria-hidden="true">${body}</svg>`;
}

/** What each alignment command does, drawn as three little shapes. */
export function alignIcon(kind: string): string {
  const bar = (x: number, y: number, w: number, h: number): string =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="currentColor" opacity="0.65"/>`;
  const rule = (x1: number, y1: number, x2: number, y2: number): string =>
    `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="currentColor" stroke-width="1.2"/>`;
  const body = ((): string => {
    switch (kind) {
      case 'left': return rule(2, 1, 2, 15) + bar(3, 3, 11, 4) + bar(3, 9, 7, 4);
      case 'right': return rule(16, 1, 16, 15) + bar(4, 3, 11, 4) + bar(8, 9, 7, 4);
      case 'centre': return rule(9, 1, 9, 15) + bar(3.5, 3, 11, 4) + bar(5.5, 9, 7, 4);
      case 'top': return rule(1, 2, 17, 2) + bar(3, 3, 4, 11) + bar(9, 3, 4, 7);
      case 'bottom': return rule(1, 14, 17, 14) + bar(3, 3, 4, 10) + bar(9, 7, 4, 6);
      case 'middle': return rule(1, 8, 17, 8) + bar(3, 2.5, 4, 11) + bar(9, 4.5, 4, 7);
      case 'spread-x': return bar(1, 4, 3, 8) + bar(7.5, 4, 3, 8) + bar(14, 4, 3, 8);
      case 'spread-y': return bar(4, 1, 10, 3) + bar(4, 6.5, 10, 3) + bar(4, 12, 10, 3);
      default: return '';
    }
  })();
  return `<svg viewBox="0 0 18 16" width="18" height="16" aria-hidden="true">${body}</svg>`;
}

/** A part from the library, drawn at the size of a line of text. */
export function partIcon(body: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="16" aria-hidden="true">${body}</svg>`;
}
