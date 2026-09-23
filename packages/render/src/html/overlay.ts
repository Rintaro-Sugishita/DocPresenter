// Renders an overlay: a screenshot with numbered callouts. The image is a
// binary a diff cannot show, so only the markers and their wording are ours to
// draw — and those are what a reviewer actually argues about. The image keeps
// its natural size because the coordinates in the file are image pixels.

import type { Callout, DiagramFile } from '@docpresenter/core';
import { escapeAttr, escapeHtml } from './table.js';

export function renderOverlay(diagram: DiagramFile, src = diagram.image): string {
  if (src === undefined) {
    return '<p class="dp-missing">overlay に画像が指定されていない</p>';
  }
  const markers = diagram.callouts.map(renderMarker).join('\n');
  const legend = diagram.callouts
    .map(c => `<li><span class="dp-callout-marker">${escapeHtml(c.marker)}</span>`
      + ` ${escapeHtml(c.text)}</li>`)
    .join('\n');

  return [
    '<div class="dp-overlay">',
    `<img class="dp-overlay-image" src="${escapeAttr(src)}" alt="">`,
    markers,
    '</div>',
    `<ol class="dp-callouts">\n${legend}\n</ol>`,
  ].join('\n');
}

/**
 * A marker and the leader line to what it points at. The line is an SVG the
 * size of the marker's bounding box with the target, so nothing but the line
 * itself is drawn over the screenshot.
 */
function renderMarker(callout: Callout): string {
  const left = Math.min(callout.x, callout.targetX);
  const top = Math.min(callout.y, callout.targetY);
  const width = Math.max(1, Math.abs(callout.targetX - callout.x));
  const height = Math.max(1, Math.abs(callout.targetY - callout.y));
  const leader = `<svg class="dp-callout-leader" style="left:${left}px;top:${top}px"`
    + ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`
    + ` xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<line x1="${callout.x - left}" y1="${callout.y - top}"`
    + ` x2="${callout.targetX - left}" y2="${callout.targetY - top}"/></svg>`;

  return leader
    + `<span class="dp-callout" style="left:${callout.x}px;top:${callout.y}px"`
    + ` title="${escapeAttr(callout.text)}">${escapeHtml(callout.marker)}</span>`;
}
