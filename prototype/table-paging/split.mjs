// Splits a table across pages ourselves instead of leaving it to the
// fragmenter: the header row is repeated on every page, and a merged cell that
// straddles a page boundary is cut and continued on the next page.

/** Rows carry cells that may span; a cell occupies `rowspan` consecutive rows. */
export function splitTable(rows, rowHeights, headerHeight, firstPageHeight, pageHeight) {
  // 1. Pack rows into pages by measured height.
  const pages = [];
  let current = [], used = headerHeight, limit = firstPageHeight;
  rows.forEach((row, i) => {
    if (current.length && used + rowHeights[i] > limit) {
      pages.push(current);
      current = []; used = headerHeight; limit = pageHeight;
    }
    current.push(i);
    used += rowHeights[i];
  });
  if (current.length) pages.push(current);

  // 2. Walk the grid so that a span crossing a boundary is cut and continued.
  //    `active[col]` holds the cell still covering the current row.
  const active = new Map();
  const out = pages.map(() => []);
  pages.forEach((rowIdx, p) => {
    const pageEnd = rowIdx[rowIdx.length - 1];
    // Carry spans that started on an earlier page into this one.
    const carried = [];
    for (const [col, st] of active) {
      if (st.lastRow >= rowIdx[0]) {
        const span = Math.min(st.lastRow, pageEnd) - rowIdx[0] + 1;
        carried.push({ col, cell: { ...st.cell, rowspan: span, continued: true } });
      }
    }
    rowIdx.forEach((r, k) => {
      const emitted = [];
      if (k === 0) emitted.push(...carried.map(c => c.cell));
      for (const cell of rows[r]) {
        const span = cell.rowspan ?? 1;
        const lastRow = r + span - 1;
        const clipped = Math.min(lastRow, pageEnd) - r + 1;   // cut at the page end
        emitted.push({ ...cell, rowspan: clipped });
        if (span > 1) active.set(cell.col, { cell, lastRow });
      }
      out[p].push(emitted);
    });
    // Drop spans that ended on this page.
    for (const [col, st] of [...active]) if (st.lastRow <= pageEnd) active.delete(col);
  });
  return out;
}
