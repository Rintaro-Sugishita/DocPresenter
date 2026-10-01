// The document editor's own chrome: the page, the blocks, the table grid
// and the sheet tabs. The parts it shares with the drawing editor are in
// the base package, and the canvas's parts are in the diagram package.

export const EDITOR_STYLE = `
.dp-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #f4f5f7; }
.dp-editor-pane { flex: 1; overflow: auto; padding: 2.5em 0; }
.dp-editor-pane > .dp-page {
  background: #fff; max-width: 48em; margin: 0 auto 2em;
  padding: 3em 3.5em; box-shadow: 0 1px 4px rgba(0,0,0,.12);
}
.dp-editor-pane .dp-sheet[hidden] { display: none; }

/* The page-break guide marks a boundary between two visible sheets. With one
   sheet on screen there is no boundary to mark, so it is suppressed. */
.dp-editor-pane:not(.dp-continuous) .dp-sheet + .dp-sheet {
  border-top: none; margin-top: 0; padding-top: 0;
}
.dp-editor-pane:not(.dp-continuous) .dp-sheet + .dp-sheet::after { content: none; }

/* Editing a block shows the Markdown that produced it, in the document's own
   type so the shape of what you are writing does not change under you. */
.dp-editing { position: relative; }
.dp-block-source {
  display: block; width: 100%; box-sizing: border-box;
  font: inherit; line-height: inherit; color: inherit;
  background: #fffdf5; border: 1px solid #d8b96b; border-radius: 3px;
  padding: 0.4em 0.6em; resize: none; overflow: hidden;
}
.dp-block-source:focus { outline: 2px solid #d8b96b; outline-offset: -1px; }

/* Where a new block begins. An empty sheet says so; a sheet with content
   keeps it quiet until the pointer is over it. */
.dp-append {
  cursor: text; min-height: 0.9em; padding: 0.15em 0;
  display: flex; align-items: center; gap: 0.5em;
  font-family: var(--font-heading, sans-serif); font-size: 0.85em;
  color: #a7aeb8; position: relative;
}
/* Between blocks it is a thin strip; it opens up under the pointer. */
.dp-append:hover { min-height: 1.8em; }
.dp-sheet > .dp-append:last-child { min-height: 1.8em; padding: 0.5em 0; }
.dp-append-hint { flex: 0 0 auto; }
.dp-append:hover .dp-append-hint:empty::before { content: "ここに本文を書く"; }
.dp-sheet-empty .dp-append { color: #8b929c; min-height: 3em; }
/* The buttons are quiet until the pointer is near; the sheet is for reading. */
.dp-append-add {
  border: 1px solid #d3d7dd; background: #fff; color: #6b7280; cursor: pointer;
  border-radius: 3px; padding: 0.15em 0.6em; font: inherit; font-size: 0.95em;
  opacity: 0; transition: opacity .12s;
}
.dp-append:hover .dp-append-add, .dp-sheet-empty .dp-append-add { opacity: 1; }
.dp-append-add:hover { background: #eceef1; color: #3a4048; }
.dp-append.dp-editing, .dp-append:has(.dp-block-source) { color: inherit; font-size: inherit; }
.dp-append:has(.dp-block-source) .dp-append-add { display: none; }
/* Figures. The drawing is a file of its own and the caption stands for the
   import line that placed it, so each is hinted as its own target. */
.dp-figure-body { position: relative; }
.dp-editor-pane .dp-figure-body:hover,
.dp-editor-pane .dp-caption:hover,
.dp-editor-pane .dp-import-line:hover {
  outline: 1px dashed #c3a45a; outline-offset: 4px; cursor: text;
}
.dp-import-line {
  font-family: ui-monospace, monospace; font-size: 0.75em;
  color: #a7aeb8; margin-top: 0.5em;
}
.dp-broken {
  font-family: system-ui, sans-serif; font-size: 0.85em; color: #b3261e;
  margin: 0 0 0.5em;
}
.dp-figure-body .dp-block-source {
  font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.6;
}

/* The grid editor. It is editor chrome, not the document: the printed table
   is styled by the theme, and this is the thing you type into. */
.dp-grid { font-family: system-ui, sans-serif; font-size: 13px; }
.dp-grid .dp-format-bar { position: static; margin-bottom: 0.5em; width: fit-content; }
.dp-grid-table { table-layout: fixed; }
.dp-grid-bar {
  display: flex; flex-wrap: wrap; align-items: stretch; gap: 1px; margin-bottom: 0.5em;
}
.dp-grid-bar button {
  border: 1px solid #d3d7dd; background: #f7f8fa; color: #3a4048; cursor: pointer;
  padding: 0.3em 0.6em; border-radius: 3px; font: inherit; font-size: 12px;
}
.dp-grid-bar button:hover { background: #eceef1; }
.dp-grid-divider { width: 1px; background: #d3d7dd; margin: 0.2em 0.4em; }
.dp-grid-style { margin-bottom: 0.7em; align-items: center; gap: 2px; }
.dp-grid-label { color: #6b7280; font-size: 11px; margin: 0 0.2em 0 0.5em; }
.dp-grid-bar .dp-grid-swatch {
  width: 1.4em; height: 1.4em; padding: 0; border-radius: 3px;
  border: 1px solid #aeb4bd; background: var(--swatch); cursor: pointer;
}
.dp-grid-bar .dp-grid-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px #1f5fa8; }
.dp-grid-bar .dp-grid-swatch:disabled { opacity: 0.4; cursor: default; }
.dp-grid-swatch-picker {
  width: 1.6em; height: 1.6em; padding: 0; border: 1px solid #aeb4bd;
  border-radius: 3px; background: none; cursor: pointer;
}
.dp-grid-swatch-reset {
  border: 1px solid #d3d7dd; background: #f7f8fa; color: #6b7280;
  border-radius: 3px; cursor: pointer; padding: 0.15em 0.5em; font: inherit; font-size: 12px;
}
.dp-grid-swatch-reset:hover { background: #eceef1; }
.dp-grid-swatch-reset:disabled { opacity: .4; cursor: default; }

/* The selected cell's text box takes the caret while a cell is open, so it
   must show a text cursor rather than the grid's own. */
.dp-grid-editing .dp-grid-input { cursor: text; user-select: text; }

/* Dragging the edge of a header cell sets the column's width. */
.dp-grid-resize {
  position: absolute; top: 0; right: -3px; width: 7px; height: 100%;
  cursor: col-resize; z-index: 1;
}
.dp-grid-resize:hover { background: #1f5fa8; opacity: .25; }
.dp-grid-target {
  font: inherit; font-size: 12px; padding: 0.25em 0.3em;
  border: 1px solid #d3d7dd; border-radius: 3px; background: #fff; color: #3a4048;
}
.dp-grid-bar button[aria-pressed="true"] {
  background: #2d3138; color: #fff; border-color: #2d3138;
}
.dp-grid-bar button:disabled { opacity: 0.4; cursor: default; }

.dp-grid-table { border-collapse: collapse; width: 100%; }
.dp-grid-table th, .dp-grid-table td {
  border: 1px solid #c8ccd2; padding: 0.3em 0.5em; vertical-align: top;
  font-weight: 400; text-align: left; outline: none; position: relative;
  /* A row added with nothing in it would otherwise be a line too thin to aim
     at. On a table cell, height is a minimum. */
  height: 1.7em;
}
.dp-grid-table th { background: #eef0f3; font-weight: 600; }
.dp-grid-table .dp-align-left { text-align: left; }
.dp-grid-table .dp-align-center { text-align: center; }
.dp-grid-table .dp-align-right { text-align: right; }
/* The grid wears the document's own style classes, so the theme's tokens have
   to reach it. The selection outline must still win over a fill. */
.dp-grid-table .dp-bottom-thick { border-bottom: 2px solid #2d3138; }
.dp-grid-table .dp-bottom-double { border-bottom: 3px double #2d3138; }
.dp-grid-table .dp-right-thick { border-right: 2px solid #2d3138; }
/* A picked rectangle. The cell the keyboard is on keeps its own outline. */
.dp-grid-table .dp-grid-picked { background: rgba(31, 95, 168, .10); }
.dp-grid-table .dp-grid-at { box-shadow: inset 0 0 0 2px #1f5fa8; }

/* The text box covers the selected cell. While navigating it is invisible and
   the cell's own text shows through; typing into it flips the cell to editing,
   which is the only way IME input can be caught from the first keystroke. */
.dp-grid-input {
  position: absolute; inset: 0; width: 100%; box-sizing: border-box;
  font: inherit; text-align: inherit; border: none; outline: none;
  padding: 0.3em 0.5em; margin: 0;
  background: transparent; color: transparent; caret-color: transparent;
}
.dp-grid-editing .dp-grid-text { visibility: hidden; }
.dp-grid-editing .dp-grid-input { background: #fff; color: inherit; caret-color: auto; }

.dp-tabbar {
  display: flex; align-items: stretch; gap: 2px;
  border-top: 1px solid #c8ccd2; background: #e9ebef;
  padding: 0 0.5em; overflow-x: auto; flex: 0 0 auto;
  font-family: system-ui, sans-serif; font-size: 13px;
}
.dp-tab {
  display: flex; align-items: center; gap: 0.4em;
  border: none; background: transparent; cursor: pointer;
  padding: 0.55em 0.9em; color: #3a4048; white-space: nowrap;
  border-bottom: 2px solid transparent;
}
.dp-tab:hover { background: #dfe2e7; }
.dp-tab[aria-selected="true"] {
  background: #fff; color: #1c1f24; font-weight: 600;
  border-bottom-color: #1f5fa8;
}
.dp-tab[data-empty="true"] { font-style: italic; color: #8b929c; }
.dp-tab.dp-drop-before { box-shadow: inset 2px 0 0 #1f5fa8; }
.dp-tab.dp-drop-after  { box-shadow: inset -2px 0 0 #1f5fa8; }
.dp-tab-close {
  display: none;
  border: none; background: transparent; cursor: pointer;
  color: #8b929c; font-size: 14px; line-height: 1; padding: 0 0.1em;
}
.dp-tab[aria-selected="true"] .dp-tab-close { display: inline; }
.dp-tab-close:hover { color: #b3261e; }
.dp-tab-rename {
  font: inherit; font-weight: 600; border: 1px solid #1f5fa8; border-radius: 2px;
  padding: 0.1em 0.3em; width: 100%; min-width: 0; box-sizing: border-box;
}
.dp-tab-add { font-size: 15px; padding: 0.55em 0.8em; color: #5a6270; }
/* 画像の操作。画像には開くソースが無いので、エディタの代わりにこれが立つ。
   どのボタンも、置いた取り込み行の属性 1 つを書き換えるだけである。 */
.dp-picture-bar {
  display: flex; align-items: center; gap: 2px; margin-bottom: 0.4em;
  font-family: system-ui, sans-serif; font-size: 12px;
}
.dp-picture-bar button {
  border: 1px solid #d3d7dd; background: #f7f8fa; color: #3a4048; cursor: pointer;
  padding: 0.25em 0.7em; border-radius: 3px; font: inherit; font-size: 12px;
}
.dp-picture-bar button:hover { background: #eceef1; }
.dp-picture-bar button[aria-pressed="true"] {
  background: #2d3138; color: #fff; border-color: #2d3138;
}
.dp-picture-size { color: #6b7280; margin: 0 0.6em; min-width: 3.5em; }
.dp-picture-open > .dp-figure-body { position: relative; outline: 1px solid #1f5fa8; }
/* つまむところ。右端の真ん中に置く——横幅だけを変えるので、縦に動かす手は要らない。 */
.dp-picture-handle {
  position: absolute; right: -5px; top: 50%; transform: translateY(-50%);
  width: 10px; height: 28px; border-radius: 2px;
  background: #1f5fa8; cursor: ew-resize;
}
/* 画像を落とす先。どの隙間に入るかを、落とす前に見せる。 */
.dp-append-over { min-height: 1.8em; background: rgba(31, 95, 168, .10); outline: 1px dashed #1f5fa8; }

.dp-tabbar-spacer { flex: 1; }
.dp-tabbar-toggle {
  border: none; background: transparent; cursor: pointer;
  color: #5a6270; padding: 0.55em 0.9em; white-space: nowrap;
}
.dp-tabbar-toggle[aria-pressed="true"] { color: #1f5fa8; font-weight: 600; }
`;
