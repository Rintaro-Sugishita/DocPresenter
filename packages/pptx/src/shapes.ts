// Slide contents, as DrawingML.
//
// Every shape here is a preset. That is the whole requirement behind the PPTX
// output: the person who receives the deck opens a shape's handle and drags
// it, and a picture pasted onto a slide gives them nothing to drag. The
// drawing vocabulary was restricted to what DrawingML can express for exactly
// this reason.

import { EDGE_LABEL, type Run } from '@docpresenter/diagram';
import { EMU_PER_PT, EMU_PER_PX } from './model.js';
import type {
  Attachment, DrawingBlock, DrawnConnector, DrawnShape, PictureBlock, TableBlock, TableCell, TextBlock,
} from './model.js';
import { escapeXml, hex } from './xml.js';

/** Where the contents of a slide sit, in EMU. */
export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

let counter = 1;
export function resetIds(): void { counter = 1; }
function nextId(): number { return ++counter; }

/** A run's properties, shared by every kind of text on a slide. */
function runXml(run: Run, size: number, colour: string): string {
  const properties = [
    `lang="ja-JP"`, `sz="${Math.round(size * 100)}"`,
    run.bold ? 'b="1"' : '', run.italic ? 'i="1"' : '',
  ].filter(Boolean).join(' ');
  const fill = `<a:solidFill><a:srgbClr val="${hex(run.colour ?? colour, '1C1F24')}"/></a:solidFill>`;
  const face = run.code ? '<a:latin typeface="Consolas"/><a:ea typeface="Consolas"/>' : '';
  return `<a:r><a:rPr ${properties}>${fill}${face}</a:rPr>`
    + `<a:t>${escapeXml(run.text)}</a:t></a:r>`;
}

function paragraph(runs: readonly Run[], size: number, colour: string, align: string): string {
  const body = runs.length === 0
    ? `<a:endParaRPr lang="ja-JP" sz="${Math.round(size * 100)}"/>`
    : runs.map(run => runXml(run, size, colour)).join('');
  return `<a:p><a:pPr algn="${align}"/>${body}</a:p>`;
}

export function textBox(
  block: TextBlock, frame: Frame, size: number, colour = '#1c1f24', align = 'l',
): string {
  const id = nextId();
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>`
    + `${block.paragraphs.map(runs => paragraph(runs, size, colour, align)).join('')}`
    + `</p:txBody></p:sp>`;
}

export function picture(block: PictureBlock, frame: Frame, relationship: number): string {
  const id = nextId();
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="picture ${id}"/>`
    + `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="rId${relationship}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr>${xfrm(frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/**
 * The drawing. Everything in it is placed by the same scale, so the picture
 * that arrives is the picture the author drew — and every piece of it is a
 * shape with handles.
 */
/** How a drawing was placed, so the way back is arithmetic rather than guessing. */
export interface Placement {
  readonly source: string;
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
}

export function drawing(
  block: DrawingBlock, frame: Frame, placed?: (placement: Placement) => void,
): string {
  const scale = Math.min(
    frame.width / (block.width * EMU_PER_PX),
    frame.height / (block.height * EMU_PER_PX),
  );
  const width = block.width * EMU_PER_PX * scale;
  const height = block.height * EMU_PER_PX * scale;
  const left = frame.x + (frame.width - width) / 2;
  const top = frame.y + (frame.height - height) / 2;
  const at = (x: number, y: number): { x: number; y: number } => ({
    x: Math.round(left + x * EMU_PER_PX * scale),
    y: Math.round(top + y * EMU_PER_PX * scale),
  });
  const size = (value: number): number => Math.round(value * EMU_PER_PX * scale);

  placed?.({
    source: block.source ?? '', scale: EMU_PER_PX * scale, originX: left, originY: top,
  });

  // Numbered before anything is written: a connector names the shapes it is
  // fixed to, and the shapes in front of it are written after it.
  const ids = new Map(block.shapes.map(shape => [shape.id, nextId()]));
  const behind = block.shapes.filter(shape => shape.behind);
  const front = block.shapes.filter(shape => !shape.behind);
  return [
    ...behind.map(shape => shapeXml(shape, ids.get(shape.id)!, at, size, scale)),
    ...block.connectors.map(connector => connectorXml(connector, block.shapes, ids, at, scale)),
    ...front.map(shape => shapeXml(shape, ids.get(shape.id)!, at, size, scale)),
    // On top, as on screen: a label's plate covers the line it names, and no
    // shape is laid over a label.
    ...block.connectors.map(connector => edgeLabelXml(connector, at, size, scale)),
  ].join('');
}

/**
 * A connection's label, as a text box on a white plate. Named `edge from->to`
 * after the connection, so reading the deck back knows it for a label and not
 * a shape somebody added.
 */
function edgeLabelXml(
  connector: DrawnConnector,
  at: (x: number, y: number) => { x: number; y: number },
  size: (value: number) => number,
  scale: number,
): string {
  if (!connector.label || !connector.labelBox) return '';
  const box = connector.labelBox;
  const origin = at(box.x, box.y);
  const frame: Frame = { x: origin.x, y: origin.y, width: size(box.width), height: size(box.height) };
  const name = connector.between ? `edge ${connector.between.from}->${connector.between.to}` : `text ${nextId()}`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${nextId()}" name="${escapeXml(name)}"/>`
    + `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`
    + `<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>`
    + `<p:txBody><a:bodyPr anchor="ctr" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr>`
    + `<a:lstStyle/>${connector.label.map(line =>
      paragraph(line, EDGE_LABEL.fontSize * (EMU_PER_PX / EMU_PER_PT) * scale, '#3a4048', 'ctr')).join('')}</p:txBody></p:sp>`;
}

function shapeXml(
  shape: DrawnShape,
  id: number,
  at: (x: number, y: number) => { x: number; y: number },
  size: (value: number) => number,
  scale: number,
): string {
  const origin = at(shape.x, shape.y);
  const frame: Frame = {
    x: origin.x, y: origin.y, width: size(shape.width), height: size(shape.height),
  };
  const fill = shape.fill
    ? `<a:solidFill><a:srgbClr val="${hex(shape.fill, 'FFFFFF')}"/></a:solidFill>`
    : '<a:noFill/>';
  const line = shape.line
    ? `<a:ln w="${Math.round((shape.weight ?? 1.4) * EMU_PER_PX * scale)}">`
      + `<a:solidFill><a:srgbClr val="${hex(shape.line, '3A4048')}"/></a:solidFill>`
      + `${shape.dashed ? '<a:prstDash val="dash"/>' : ''}</a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  const align = shape.align === 'left' ? 'l' : shape.align === 'right' ? 'r' : 'ctr';
  const body = shape.lines.length === 0
    ? '<a:p><a:endParaRPr lang="ja-JP"/></a:p>'
    : shape.lines.map(runs =>
      paragraph(runs, shape.fontSize * scale, shape.colour ?? '#1c1f24', align)).join('');

  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(shape.id)}"/>`
    + `<p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(frame)}<a:prstGeom prst="${shape.preset}"><a:avLst/></a:prstGeom>`
    + `${fill}${line}</p:spPr>`
    + `<p:txBody><a:bodyPr anchor="ctr" wrap="square"><a:normAutofit/></a:bodyPr>`
    + `<a:lstStyle/>${body}</p:txBody></p:sp>`;
}

/**
 * Where on each preset PowerPoint keeps a connection, by side: the index of the
 * connection site in the preset's own definition. A preset missing here has its
 * sites somewhere else, and a line drawn to it is left unattached rather than
 * fixed to a point that would move it.
 */
const SITES: Readonly<Record<string, Readonly<Record<Attachment['side'], number>>>> = {
  rect:      { top: 0, left: 1, bottom: 2, right: 3 },
  roundRect: { top: 0, left: 1, bottom: 2, right: 3 },
  diamond:   { top: 0, left: 1, bottom: 2, right: 3 },
};

/**
 * A connection. Two points make a straight connector, and a path that turns
 * twice at right angles makes an elbow connector — both are connectors
 * PowerPoint understands as one, and keeps on the shapes when they are moved.
 * Any other path makes a freeform, because a connector cannot hold a path of
 * its own — and the corners the author put in are not ours to throw away.
 */
function connectorXml(
  connector: DrawnConnector,
  shapes: readonly DrawnShape[],
  ids: ReadonlyMap<string, number>,
  at: (x: number, y: number) => { x: number; y: number },
  scale: number,
): string {
  const points = connector.points.map(point => at(point.x, point.y));
  if (points.length < 2) return '';
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - left);
  const height = Math.max(1, Math.max(...ys) - top);
  const id = nextId();
  const line = `<a:ln w="${Math.round((connector.weight ?? 1.4) * EMU_PER_PX * scale)}">`
    + `<a:solidFill><a:srgbClr val="${hex(connector.line, '3A4048')}"/></a:solidFill>`
    + `${connector.dashed ? '<a:prstDash val="dash"/>' : ''}`
    + `${connector.startArrow ? '<a:headEnd type="triangle" w="med" len="med"/>' : ''}`
    + `${connector.arrow ? '<a:tailEnd type="triangle" w="med" len="med"/>' : ''}</a:ln>`;

  const fixed = (end: Attachment | undefined, element: string): string => {
    if (!end) return '';
    const preset = shapes.find(shape => shape.id === end.shape)?.preset;
    const site = preset === undefined ? undefined : SITES[preset]?.[end.side];
    const shape = ids.get(end.shape);
    return site === undefined || shape === undefined ? '' : `<a:${element} id="${shape}" idx="${site}"/>`;
  };
  const head = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="line ${id}"/>`
    + `<p:cNvCxnSpPr>${fixed(connector.start, 'stCxn')}${fixed(connector.end, 'endCxn')}</p:cNvCxnSpPr>`
    + `<p:nvPr/></p:nvCxnSpPr>`;

  if (points.length === 2) {
    const first = points[0]!;
    const last = points[1]!;
    const flipH = last.x < first.x ? ' flipH="1"' : '';
    const flipV = last.y < first.y ? ' flipV="1"' : '';
    return head
      + `<p:spPr><a:xfrm${flipH}${flipV}><a:off x="${left}" y="${top}"/>`
      + `<a:ext cx="${width}" cy="${height}"/></a:xfrm>`
      + `<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>${line}</p:spPr>`
      + `</p:cxnSp>`;
  }

  const bent = elbow(points);
  if (bent) {
    return head
      + `<p:spPr>${bent.xfrm}<a:prstGeom prst="bentConnector3"><a:avLst>`
      + `<a:gd name="adj1" fmla="val ${bent.adjust}"/></a:avLst></a:prstGeom>${line}</p:spPr>`
      + `</p:cxnSp>`;
  }

  const path = points.map((point, i) =>
    `<a:${i === 0 ? 'moveTo' : 'lnTo'}><a:pt x="${point.x - left}" y="${point.y - top}"/></a:${i === 0 ? 'moveTo' : 'lnTo'}>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="line ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${left}" y="${top}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>`
    + `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>`
    + `<a:rect l="0" t="0" r="r" b="b"/>`
    + `<a:pathLst><a:path w="${width}" h="${height}">${path}</a:path></a:pathLst></a:custGeom>`
    + `<a:noFill/>${line}</p:spPr>`
    + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ja-JP"/></a:p></p:txBody></p:sp>`;
}

/**
 * A path that turns twice at right angles, as PowerPoint's elbow connector.
 *
 * The preset is drawn across its box from the top-left corner: along, over at
 * `adj1` of the way, then along again to the bottom-right. Flips point it the
 * right way, and a quarter turn makes it run down first — in which case the
 * box is written as it is before the turn, its sides swapped about the centre.
 */
function elbow(
  points: readonly { x: number; y: number }[],
): { xfrm: string; adjust: number } | undefined {
  if (points.length !== 4) return undefined;
  const [s, p, q, e] = points as [
    { x: number; y: number }, { x: number; y: number },
    { x: number; y: number }, { x: number; y: number }];
  const across = s.y === p.y && p.x === q.x && q.y === e.y;
  const down = s.x === p.x && p.y === q.y && q.x === e.x;
  const spanX = Math.abs(e.x - s.x);
  const spanY = Math.abs(e.y - s.y);
  if ((!across && !down) || spanX === 0 || spanY === 0) return undefined;

  const cx = (s.x + e.x) / 2;
  const cy = (s.y + e.y) / 2;
  let width: number;
  let height: number;
  let attributes: string;
  let along: number;
  if (across) {
    width = spanX;
    height = spanY;
    attributes = `${e.x < s.x ? ' flipH="1"' : ''}${e.y < s.y ? ' flipV="1"' : ''}`;
    along = (p.x - s.x) / (e.x - s.x);
  } else {
    // A quarter turn clockwise makes the preset run down and then to the
    // left; three quarters, up and then to the right. A flip takes the other.
    const downwards = e.y > s.y;
    width = spanY;
    height = spanX;
    const flip = downwards ? e.x > s.x : e.x < s.x;
    attributes = ` rot="${downwards ? 5400000 : 16200000}"${flip ? ' flipV="1"' : ''}`;
    along = (p.y - s.y) / (e.y - s.y);
  }
  return {
    xfrm: `<a:xfrm${attributes}><a:off x="${Math.round(cx - width / 2)}" y="${Math.round(cy - height / 2)}"/>`
      + `<a:ext cx="${width}" cy="${height}"/></a:xfrm>`,
    adjust: Math.round(along * 100000),
  };
}

/** The margins inside a cell, in EMU: left and right, top and bottom. */
const CELL_SIDE = 91440;     // 0.1 in
const CELL_EDGE = 54864;     // 0.06 in
/** The size a table is set in — the size of the prose beside it — and the least it is shrunk to before it overflows. */
export const TABLE_SIZE = 14;
const TABLE_LEAST = 8;

/** How wide a run of text is, in ems: a full-width character is one, the rest about half. */
function ems(text: string): number {
  let width = 0;
  for (const character of text) width += character.codePointAt(0)! > 0xff ? 1 : 0.55;
  return width;
}

const cellText = (cell: TableCell): string => cell.runs.map(run => run.text).join('');

/** Where a table's columns and rows fall, worked out from what is in them. */
export interface TableLayout {
  readonly size: number;
  readonly widths: readonly number[];
  readonly heights: readonly number[];
  readonly width: number;
  readonly height: number;
}

/**
 * Lays a table out in the room it has: each column as wide as the author said
 * or as its contents need, each row as tall as its text — not stretched to the
 * height of the slide, where a two-row table becomes two bands of empty space.
 * A table too tall for the room is set smaller, down to a floor.
 */
export function layOutTable(block: TableBlock, room: { width: number; height: number }): TableLayout {
  const count = block.columns.length;
  // What each column holds at its widest, in ems: a cell that spans columns
  // says nothing about any one of them.
  const content = Array.from({ length: count }, (_, c) => Math.min(40, Math.max(2, ...block.rows.map(row => {
    const cell = row.cells[c];
    return cell && cell.covered === 'none' && cell.colSpan === 1 ? ems(cellText(cell)) + 1 : 0;
  }))));

  for (let size = TABLE_SIZE; ; size -= 0.5) {
    const em = size * EMU_PER_PT;
    const fixed = block.widths ?? [];
    let widths: number[];
    if (fixed.some(width => width !== undefined)) {
      // As wide as the slide, as the page is: the author's shares first, and
      // the columns they left open divide the rest by what they hold.
      const given = fixed.reduce<number>((sum, width) => sum + (width ?? 0), 0);
      const open = content.reduce((sum, ems, c) => sum + (fixed[c] === undefined ? ems : 0), 0);
      const rest = Math.max(0, 1 - given);
      widths = content.map((ems, c) => room.width * (fixed[c] ?? (open > 0 ? rest * ems / open : 0)));
    } else {
      // As wide as its contents, and no wider than the slide.
      const natural = content.map(ems => ems * em + CELL_SIDE * 2);
      const total = natural.reduce((a, b) => a + b, 0);
      widths = total <= room.width ? natural : natural.map(width => width * room.width / total);
    }
    widths = widths.map(width => Math.round(width));

    const line = Math.round(size * 1.25 * EMU_PER_PT);
    const heights = block.rows.map(row => Math.max(...row.cells.map((cell, c) => {
      if (cell.covered !== 'none' || cell.rowSpan > 1) return 0;
      const across = widths.slice(c, c + cell.colSpan).reduce((a, b) => a + b, 0) - CELL_SIDE * 2;
      const lines = Math.max(1, Math.ceil((ems(cellText(cell)) * em) / Math.max(em, across)));
      return lines * line;
    }), line) + CELL_EDGE * 2);
    const height = heights.reduce((a, b) => a + b, 0);
    if (height <= room.height || size <= TABLE_LEAST) {
      return { size, widths, heights, width: widths.reduce((a, b) => a + b, 0), height };
    }
  }
}

/** A short sum of what a table says, cell by cell, to tell later whether it was changed. */
export function tableSum(rows: readonly (readonly string[])[]): string {
  let h = 2166136261;
  const text = rows.map(row => row.join('\t')).join('\n');
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** A table, as a native table: the rows stay rows in PowerPoint. */
export function table(block: TableBlock, frame: Frame): string {
  const id = nextId();
  const laid = layOutTable(block, frame);

  const rows = block.rows.map((row, r) =>
    `<a:tr h="${laid.heights[r]}">${row.cells.map(cell => cellXml(cell, laid.size, row.header)).join('')}</a:tr>`,
  ).join('');
  // Named after the file it came from, with a sum of what it says, so that a
  // deck that comes back can tell a table changed in PowerPoint.
  const name = block.source === undefined ? `table ${id}`
    : `dp:table=${block.source};sum=${tableSum(block.rows.map(row => row.cells.map(cellText)))}`;

  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${escapeXml(name)}"/>`
    + `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${frame.x}" y="${frame.y}"/><a:ext cx="${laid.width}" cy="${laid.height}"/></p:xfrm>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">`
    + `<a:tbl><a:tblPr firstRow="1" bandRow="0"/>`
    + `<a:tblGrid>${laid.widths.map(width => `<a:gridCol w="${width}"/>`).join('')}</a:tblGrid>`
    + `${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function cellXml(cell: TableCell, size: number, header: boolean): string {
  const span = [
    cell.rowSpan > 1 ? ` rowSpan="${cell.rowSpan}"` : '',
    cell.colSpan > 1 ? ` gridSpan="${cell.colSpan}"` : '',
    cell.covered === 'horizontal' ? ' hMerge="1"' : '',
    cell.covered === 'vertical' ? ' vMerge="1"' : '',
  ].join('');
  const align = cell.align === 'center' ? 'ctr' : cell.align === 'right' ? 'r' : 'l';
  const fill = cell.fill
    ? `<a:solidFill><a:srgbClr val="${hex(cell.fill, 'FFFFFF')}"/></a:solidFill>`
    : header ? '<a:solidFill><a:srgbClr val="EEF0F3"/></a:solidFill>' : '';
  return `<a:tc${span}><a:txBody><a:bodyPr/><a:lstStyle/>`
    + `${paragraph(cell.runs, size, '#1c1f24', align)}</a:txBody>`
    + `<a:tcPr marL="${CELL_SIDE}" marR="${CELL_SIDE}" marT="${CELL_EDGE}" marB="${CELL_EDGE}" anchor="ctr">`
    + `${border()}${fill}</a:tcPr></a:tc>`;
}

function border(): string {
  const line = '<a:solidFill><a:srgbClr val="7A7F87"/></a:solidFill>';
  return ['lnL', 'lnR', 'lnT', 'lnB']
    .map(name => `<a:${name} w="6350">${line}</a:${name}>`).join('');
}

export function xfrm(frame: Frame): string {
  return `<a:xfrm><a:off x="${Math.round(frame.x)}" y="${Math.round(frame.y)}"/>`
    + `<a:ext cx="${Math.round(frame.width)}" cy="${Math.round(frame.height)}"/></a:xfrm>`;
}

export { EMU_PER_PT };
