// Small pictures of the shapes, for the menu that adds one. They are not the
// renderer's drawing: an icon is 16 by 12 and says which shape this is, while
// the drawing has text in it and a size someone chose.

import type { ShapeKind } from '@docpresenter/core';

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
