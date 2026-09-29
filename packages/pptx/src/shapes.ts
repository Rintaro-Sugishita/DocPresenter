// Slide contents, as DrawingML.
//
// Every shape here is a preset. That is the whole requirement behind the PPTX
// output: the person who receives the deck opens a shape's handle and drags
// it, and a picture pasted onto a slide gives them nothing to drag. The
// drawing vocabulary was restricted to what DrawingML can express for exactly
// this reason.

import type { Run } from '@docpresenter/diagram';
import { EMU_PER_PT, EMU_PER_PX } from './model.js';
import type {
  DrawingBlock, DrawnConnector, DrawnShape, PictureBlock, TableBlock, TextBlock,
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

  const behind = block.shapes.filter(shape => shape.behind);
  const front = block.shapes.filter(shape => !shape.behind);
  return [
    ...behind.map(shape => shapeXml(shape, at, size, scale)),
    ...block.connectors.map(connector => connectorXml(connector, at, size, scale)),
    ...front.map(shape => shapeXml(shape, at, size, scale)),
  ].join('');
}

function shapeXml(
  shape: DrawnShape,
  at: (x: number, y: number) => { x: number; y: number },
  size: (value: number) => number,
  scale: number,
): string {
  const id = nextId();
  const origin = at(shape.x, shape.y);
  const frame: Frame = {
    x: origin.x, y: origin.y, width: size(shape.width), height: size(shape.height),
  };
  const fill = shape.fill
    ? `<a:solidFill><a:srgbClr val="${hex(shape.fill, 'FFFFFF')}"/></a:solidFill>`
    : '<a:noFill/>';
  const line = shape.line
    ? `<a:ln w="${Math.round(1.4 * EMU_PER_PX * scale)}">`
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
 * A connection. Two points make a connector PowerPoint understands as one;
 * more points make a freeform, because a connector cannot hold a path of its
 * own — and the corners the author put in are not ours to throw away.
 */
function connectorXml(
  connector: DrawnConnector,
  at: (x: number, y: number) => { x: number; y: number },
  size: (value: number) => number,
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
  const line = `<a:ln w="${Math.round(1.4 * EMU_PER_PX * scale)}">`
    + `<a:solidFill><a:srgbClr val="${hex(connector.line, '3A4048')}"/></a:solidFill>`
    + `${connector.dashed ? '<a:prstDash val="dash"/>' : ''}`
    + `${connector.arrow ? '<a:tailEnd type="triangle" w="med" len="med"/>' : ''}</a:ln>`;

  if (points.length === 2) {
    const first = points[0]!;
    const last = points[1]!;
    const flipH = last.x < first.x ? ' flipH="1"' : '';
    const flipV = last.y < first.y ? ' flipV="1"' : '';
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="line ${id}"/>`
      + `<p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>`
      + `<p:spPr><a:xfrm${flipH}${flipV}><a:off x="${left}" y="${top}"/>`
      + `<a:ext cx="${width}" cy="${height}"/></a:xfrm>`
      + `<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>${line}</p:spPr>`
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

/** A table, as a native table: the rows stay rows in PowerPoint. */
export function table(block: TableBlock, frame: Frame, size: number): string {
  const id = nextId();
  const total = block.columns.reduce((a, b) => a + b, 0) || block.columns.length;
  const widths = block.columns.map(share => Math.round((share / total) * frame.width));
  const rowHeight = Math.max(1, Math.round(frame.height / Math.max(1, block.rows.length)));

  const rows = block.rows.map(row =>
    `<a:tr h="${rowHeight}">${row.cells.map(cell => cellXml(cell, size, row.header)).join('')}</a:tr>`,
  ).join('');

  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="table ${id}"/>`
    + `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${frame.x}" y="${frame.y}"/><a:ext cx="${frame.width}" cy="${frame.height}"/></p:xfrm>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">`
    + `<a:tbl><a:tblPr firstRow="1" bandRow="0"/>`
    + `<a:tblGrid>${widths.map(width => `<a:gridCol w="${width}"/>`).join('')}</a:tblGrid>`
    + `${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function cellXml(cell: import('./model.js').TableCell, size: number, header: boolean): string {
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
    + `<a:tcPr marL="45720" marR="45720" marT="27432" marB="27432" anchor="ctr">`
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
