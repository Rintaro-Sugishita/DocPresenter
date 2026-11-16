// A grid written as a one-sheet workbook Excel opens as it is.
//
// The header is the first row, bold and frozen. A cell whose text is plainly
// a number goes as a number in a format that shows it as written (number.ts),
// so Excel can add it up; every other cell with text goes as text, so Excel
// does not turn `001` into 1 or `1-2` into a date. Empty cells keep Excel's
// General format: what is typed into them later is read as Excel reads it.

import { zipSync, strToU8 } from 'fflate';
import { asNumber } from './number.js';
import { argbOf } from './colour.js';
import { CODE_FONT, runsOf, styleOf, uniform, type Run } from './runs.js';
import { escapeXml } from './xml.js';
import type { Grid, Horizontal } from './model.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const BODY_FONT = '游ゴシック';
const SIZE = 11;
/** Excel's id for the built-in Text format, `@`. */
const TEXT_FORMAT = 49;

export interface WriteOptions {
  /** The sheet's name: the table's file name, as the tab shows it. */
  readonly sheet: string;
}

export function writeXlsx(grid: Grid, options: WriteOptions): Uint8Array {
  const styles = new Styles();
  const rows: string[] = [];

  rows.push(row(1, grid.header.map((text, c) =>
    stringCell(ref(0, c), [{ ...plainRun(text), bold: true }], styles, { header: true }))));

  grid.rows.forEach((cells, r) => {
    rows.push(row(r + 2, cells.map((cell, c) => {
      const at = ref(r + 1, c);
      const runs = runsOf(cell.text);
      const look = { fill: cell.fill, align: cell.align };
      if (runs.length === 0) {
        const style = styles.cell({ font: undefined, number: 0, ...look });
        return style === 0 ? '' : `<c r="${at}" s="${style}"/>`;
      }
      if (uniform(runs)) {
        const number = asNumber(runs.map(run => run.text).join(''));
        if (number) {
          // Excel would put a number nobody aligned at the right; the page has it at the left.
          const style = styles.cell({ font: styleOf(runs[0]!), number: styles.format(number.format), ...look, align: look.align ?? 'left' });
          return `<c r="${at}"${style ? ` s="${style}"` : ''}><v>${number.value}</v></c>`;
        }
      }
      return stringCell(at, runs, styles, look);
    }).filter(Boolean)));
  });

  const merges = grid.merges.map(one =>
    `<mergeCell ref="${ref(one.row + 1, one.column)}:${ref(one.row + one.rows, one.column + one.columns - 1)}"/>`);
  const columns = grid.widths.map((width, c) =>
    `<col min="${c + 1}" max="${c + 1}" width="${width ?? 10}" customWidth="1"/>`);

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN}" xmlns:r="${RELS}">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="18.75"/>`
    + (columns.length > 0 ? `<cols>${columns.join('')}</cols>` : '')
    + `<sheetData>${rows.join('')}</sheetData>`
    + (merges.length > 0 ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '')
    + `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`
    + `</worksheet>`;

  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'xl/workbook.xml': strToU8(workbook(sheetName(options.sheet))),
    'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
    'xl/styles.xml': strToU8(styles.xml()),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
}

function plainRun(text: string): Run {
  return { text, bold: false, italic: false, code: false, colour: undefined };
}

function row(index: number, cells: readonly string[]): string {
  return `<row r="${index}">${cells.join('')}</row>`;
}

/** Text: one font for the whole cell when the cell is drawn one way, rich runs otherwise. */
function stringCell(
  at: string, runs: readonly Run[], styles: Styles,
  look: { fill?: string | undefined; align?: Horizontal | undefined; header?: boolean },
): string {
  const text = runs.map(run => run.text).join('');
  if (uniform(runs)) {
    const style = styles.cell({ font: styleOf(runs[0]!), number: look.header ? 0 : TEXT_FORMAT, ...look });
    return `<c r="${at}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  }
  const style = styles.cell({ font: undefined, number: TEXT_FORMAT, ...look });
  const body = runs.map(run => `<r><rPr>${fontParts(styleOf(run), 'rich')}</rPr><t xml:space="preserve">${escapeXml(run.text)}</t></r>`).join('');
  return `<c r="${at}" t="inlineStr"${style ? ` s="${style}"` : ''}><is>${body}</is></c>`;
}

/** `A1` for a zero-based row and column. */
export function ref(row: number, column: number): string {
  let name = '';
  for (let c = column + 1; c > 0; c = Math.floor((c - 1) / 26)) name = String.fromCharCode(65 + ((c - 1) % 26)) + name;
  return `${name}${row + 1}`;
}

/** A name Excel accepts for a sheet: 31 characters, none of `[]:*?/\`. */
export function sheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '').slice(0, 31);
  return cleaned === '' ? 'Sheet1' : cleaned;
}

type FontStyle = ReturnType<typeof styleOf>;

/** A font's parts, in the order Excel writes them (`cell`) or a run writes them (`rich`). */
function fontParts(font: FontStyle | undefined, kind: 'cell' | 'rich'): string {
  const name = font?.code ? CODE_FONT : BODY_FONT;
  const marks = [
    font?.bold ? '<b/>' : '', font?.italic ? '<i/>' : '', font?.strike ? '<strike/>' : '',
  ].join('');
  const under = font?.underline ? '<u/>' : '';
  const raise = font?.script ? `<vertAlign val="${font.script === 'sup' ? 'superscript' : 'subscript'}"/>` : '';
  const colour = font?.colour ? `<color rgb="${argbOf(font.colour)}"/>` : '<color theme="1"/>';
  return kind === 'cell'
    ? `${marks}${under}${raise}<sz val="${SIZE}"/>${colour}<name val="${name}"/><family val="3"/><charset val="128"/>`
    : `<rFont val="${name}"/><charset val="128"/><family val="3"/>${marks}${colour}<sz val="${SIZE}"/>${under}${raise}`;
}

/** The styles a sheet uses, each kept once and numbered as Excel counts them. */
class Styles {
  private readonly fonts = [fontParts(undefined, 'cell')];
  private readonly fills = ['<patternFill patternType="none"/>', '<patternFill patternType="gray125"/>'];
  private readonly formats = new Map<string, number>();
  private readonly xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];

  format(code: string): number {
    if (code === 'General') return 0;
    const builtIn: Record<string, number> = { '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };
    if (builtIn[code] !== undefined) return builtIn[code]!;
    let id = this.formats.get(code);
    if (id === undefined) { id = 164 + this.formats.size; this.formats.set(code, id); }
    return id;
  }

  cell(look: {
    font: FontStyle | undefined; number: number;
    fill?: string | undefined; align?: Horizontal | undefined; header?: boolean;
  }): number {
    const font = look.font ? keep(this.fonts, fontParts(look.font, 'cell')) : 0;
    const fill = look.fill
      ? keep(this.fills, `<patternFill patternType="solid"><fgColor rgb="${argbOf(look.fill)}"/><bgColor indexed="64"/></patternFill>`)
      : 0;
    const alignment = look.header
      ? `<alignment vertical="center"/>`
      : `<alignment${look.align ? ` horizontal="${look.align}"` : ''} vertical="top" wrapText="1"/>`;
    const xf = `<xf numFmtId="${look.number}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0"`
      + `${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${look.number ? ' applyNumberFormat="1"' : ''}`
      + ` applyAlignment="1">${alignment}</xf>`;
    return keep(this.xfs, xf);
  }

  xml(): string {
    const formats = [...this.formats].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN}">`
      + (formats.length > 0 ? `<numFmts count="${formats.length}">${formats.join('')}</numFmts>` : '')
      + `<fonts count="${this.fonts.length}">${this.fonts.map(one => `<font>${one}</font>`).join('')}</fonts>`
      + `<fills count="${this.fills.length}">${this.fills.map(one => `<fill>${one}</fill>`).join('')}</fills>`
      + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>`
      + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
      + `</styleSheet>`;
  }
}

function keep(list: string[], item: string): number {
  const at = list.indexOf(item);
  if (at >= 0) return at;
  list.push(item);
  return list.length - 1;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
  + `<Default Extension="xml" ContentType="application/xml"/>`
  + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
  + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
  + `</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_RELS}">`
  + `<Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/>`
  + `</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_RELS}">`
  + `<Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/>`
  + `<Relationship Id="rId2" Type="${RELS}/styles" Target="styles.xml"/>`
  + `</Relationships>`;

function workbook(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN}" xmlns:r="${RELS}">`
    + `<bookViews><workbookView/></bookViews>`
    + `<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>`
    + `</workbook>`;
}
