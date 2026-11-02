/**
 * Column widths for the table grid.
 *
 * A table may give widths to some of its columns and leave the rest to share
 * what is left. When the given widths take nearly all of it, the others are
 * left with nothing: a fixed table layout gives them no more than the
 * leftover, and a word in them runs over the next column. Here every column
 * without a width keeps room for its longest word and its header, and the
 * given widths shrink together to make that room. The source is not touched.
 */

/** A width as a table's style writes it: `18%`, `4em`, `120px`. */
export interface Length { readonly value: number; readonly unit: '%' | 'em' | 'px' }

export function parseLength(text: string | undefined): Length | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(%|em|rem|px)?\s*$/.exec(text ?? '');
  if (!match) return undefined;
  const unit = match[2] === 'rem' ? 'em' : match[2] ?? 'px';
  return { value: Number(match[1]), unit: unit as Length['unit'] };
}

/** Wide characters (CJK, kana, hangul, full-width forms), and what a word ends at. */
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;
const BREAKS = /[\s\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]+/u;

/** How wide a run of text is, in em: a wide character is 1, another about 0.6. */
function ems(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? 1 : 0.6;
  return width;
}

/** Room a column needs, in em, padding included: its header unbroken, and its longest word. */
export function columnFloor(header: string, cells: readonly string[]): number {
  let widest = ems(header.trim());
  for (const text of cells) {
    // Wide characters may break anywhere; a run of narrow ones is a word.
    for (const word of text.split(BREAKS)) {
      widest = Math.max(widest, ems(word));
    }
  }
  return Math.min(12, Math.max(2, widest)) + 1.1;
}

/**
 * The share of the table, in percent, each column is given — or undefined
 * when the widths as written already leave every column its room, or cannot
 * be read.
 *
 * `widths` are as written (undefined where none is), `floors` from
 * {@link columnFloor}, `total` the table's width and `em` its font size, both
 * in pixels.
 */
export function fitColumns(
  widths: readonly (string | undefined)[], floors: readonly number[], total: number, em: number,
): number[] | undefined {
  if (total <= 0 || widths.every(width => width === undefined)) return undefined;
  const given: (number | undefined)[] = [];
  for (const width of widths) {
    if (width === undefined) { given.push(undefined); continue; }
    const length = parseLength(width);
    if (!length) return undefined;
    given.push(length.unit === '%' ? total * length.value / 100 : length.unit === 'em' ? length.value * em : length.value);
  }
  const free = given.filter(width => width === undefined).length;
  // A table whose every column has a width is laid out as written.
  if (free === 0) return undefined;
  const floor = (c: number): number => (floors[c] ?? 0) * em;
  const room = given.reduce<number>((sum, width, c) => sum + (width === undefined ? floor(c) : 0), 0);
  const taken = given.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  // The columns without a width share what is left; fine while each gets its room.
  const share = (total - taken) / free;
  if (given.every((width, c) => width !== undefined || share >= floor(c))) return undefined;
  // Otherwise each of them gets its room and a part of anything over, in
  // proportion to it. When the room is more than there is, the widths given
  // shrink together, keeping their proportions, down to a fifth of the table.
  const forFree = taken + room <= total ? total - taken : Math.max(room ? Math.min(room, total * 0.8) : 0, total - taken);
  const scale = taken > 0 ? Math.min(1, (total - forFree) / taken) : 1;
  return given.map((width, c) => {
    const px = width === undefined
      ? (room > 0 ? floor(c) / room * forFree : forFree / free)
      : width * scale;
    return Math.round(px / total * 1000) / 10;
  });
}
