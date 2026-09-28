// The editor's own chrome. This is not part of a theme: a theme styles the
// document, and the document must look the same in the editor as it does in
// the PDF. Everything here sits outside the page.

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

.dp-format-bar {
  position: absolute; top: -2.4em; right: 0; z-index: 2;
  display: flex; align-items: stretch; gap: 1px;
  background: #2d3138; border-radius: 4px; padding: 2px;
  box-shadow: 0 2px 6px rgba(0,0,0,.25);
  font-family: system-ui, sans-serif; font-size: 12px; line-height: 1;
}
.dp-format-bar button {
  border: none; background: transparent; color: #e6e8eb; cursor: pointer;
  padding: 0.45em 0.6em; border-radius: 3px; font-size: 12px;
}
.dp-format-bar button:hover { background: #454b54; }
.dp-format-bar button[aria-pressed="true"] { background: #fff; color: #1c1f24; }
.dp-format-bold { font-weight: 700; }
.dp-format-italic { font-style: italic; }
.dp-format-code { font-family: ui-monospace, monospace; }
.dp-format-divider { width: 1px; background: #565c66; margin: 0.3em 0.25em; }
/* Each token button shows a swatch of the colour the theme gives that meaning,
   so the bar shows the vocabulary instead of only naming it. */
/* Colour is picked, not named, so the buttons are the colours themselves. */
/* The bar's own button rule sets a background, so the swatch has to outrank
   it or every colour comes out blank. */
.dp-format-bar .dp-format-swatch {
  width: 1.5em; padding: 0; background: var(--swatch);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.35);
}
.dp-format-bar .dp-format-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px #fff; }
/* The display rule above would otherwise beat the browser's rule for [hidden]. */
.dp-format-bar[hidden] { display: none; }
.dp-format-picker {
  width: 1.7em; height: 1.7em; padding: 0; border: none; background: none;
  cursor: pointer; align-self: center;
}

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

/* The context menu. It sits on the document, not inside the grid, so nothing
   it opens over can clip it. */
.dp-menu {
  position: fixed; z-index: 20; min-width: 11em;
  background: #fff; border: 1px solid #c8ccd2; border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0,0,0,.18); padding: 4px;
  font-family: system-ui, sans-serif; font-size: 13px;
}
.dp-menu button {
  display: block; width: 100%; text-align: left;
  border: none; background: transparent; color: #3a4048; cursor: pointer;
  padding: 0.4em 0.8em; border-radius: 3px; font: inherit;
}
.dp-menu button:hover, .dp-menu button:focus { background: #eceef1; outline: none; }
.dp-menu button:disabled { color: #b6bcc5; cursor: default; background: transparent; }
/* A disabled first item is the explanation above a choice, not a choice. */
.dp-menu button:disabled:first-child { color: #6b7280; font-size: 0.92em; }
.dp-menu-icon {
  display: inline-flex; width: 18px; margin-right: 0.5em; color: #5a6270; vertical-align: -3px;
}
.dp-menu-rule { height: 1px; background: #e2e4e8; margin: 4px 2px; }

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

/* The canvas: direct manipulation of a diagram. Everything here is editor
   chrome drawn over the real drawing, never part of the output. */
.dp-canvas { font-family: system-ui, sans-serif; font-size: 13px; }
.dp-canvas-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 0.5em;
}
.dp-canvas-bar button {
  border: 1px solid #d3d7dd; background: #f7f8fa; color: #3a4048; cursor: pointer;
  padding: 0.3em 0.6em; border-radius: 3px; font: inherit; font-size: 12px;
}
.dp-canvas-bar button:hover { background: #eceef1; }
.dp-canvas-bar button:disabled { opacity: 0.4; cursor: default; }
.dp-canvas-where {
  color: #3a4048; font-size: 12px; font-variant-numeric: tabular-nums;
  min-width: 14em; padding: 0.2em 0.4em; background: #f2f3f5; border-radius: 3px;
}
.dp-canvas-hint { color: #8b929c; font-size: 11px; margin-left: auto; }
/* The alignment row. It appears with the selection that gives it a meaning. */
.dp-canvas-aligners { display: inline-flex; gap: 1px; align-items: center; }
/* A display rule beats the hidden attribute, so hidden has to be said again. */
.dp-canvas-aligners[hidden] { display: none; }
.dp-canvas-icon {
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #d3d7dd; background: #f7f8fa; color: #3a4048; cursor: pointer;
  padding: 0.15em 0.25em; border-radius: 3px;
}
.dp-canvas-icon:hover { background: #eceef1; }
.dp-canvas-icon:disabled { opacity: 0.35; cursor: default; }
.dp-canvas-stage { outline: none; position: relative; }
/* The text box sits over the shape being renamed: an IME needs somewhere to
   compose from, the same reason the grid keeps one over the selected cell. */
/* The format bar over a label. The shared rule pins it to the top right of
   whatever it is in; over a drawing it is placed by hand instead. */
.dp-canvas-format { top: auto; right: auto; }
.dp-canvas-text {
  position: absolute; box-sizing: border-box; font: inherit; font-size: 13px;
  text-align: center; border: 1.5px solid #1f5fa8; border-radius: 2px;
  background: #fff; color: #1c1f24; padding: 0 0.3em; min-width: 4em;
}
.dp-canvas-stage:focus-visible { box-shadow: 0 0 0 2px #cfe0f5; }
.dp-canvas-stage [data-node] { cursor: move; }
.dp-canvas-outline {
  fill: rgba(31, 95, 168, 0.12); stroke: #1f5fa8; stroke-width: 1.5; pointer-events: none;
}
.dp-canvas-handle { fill: #fff; stroke: #1f5fa8; stroke-width: 1.5; cursor: nwse-resize; }
/* Pink and dashed, so a guide never reads as part of the drawing. */
.dp-canvas-guide { stroke: #e0439b; stroke-width: 1; stroke-dasharray: 3 3; pointer-events: none; }
.dp-canvas-edge-picked {
  fill: none; stroke: #1f5fa8; stroke-width: 2.5; opacity: 0.45; pointer-events: none;
}
.dp-canvas-end { fill: #fff; stroke: #1f5fa8; stroke-width: 1.5; cursor: move; }
/* A corner of a line. Square, so it is not mistaken for an end. */
.dp-canvas-bend { fill: #fff; stroke: #1f5fa8; stroke-width: 1.5; cursor: move; }
/* Where a corner would go. Faint until the pointer is on it: it is an offer,
   not a part of the drawing. */
.dp-canvas-bend-new { fill: #fff; stroke: #1f5fa8; stroke-width: 1.2; opacity: 0.45; cursor: move; }
.dp-canvas-bend-new:hover { opacity: 1; }
.dp-canvas-rubber { stroke: #1f5fa8; stroke-width: 1.5; stroke-dasharray: 4 3; pointer-events: none; }

/* The rubber band: what a press on empty canvas draws to pick several shapes. */
.dp-canvas-band {
  fill: rgba(31, 95, 168, 0.08); stroke: #1f5fa8; stroke-width: 1;
  stroke-dasharray: 3 2; pointer-events: none;
}
/* Connections are re-routed when the shape lands, so they fade while it moves
   rather than trailing behind it. */
.dp-canvas-dragging .dp-edge { opacity: 0.25; }
.dp-overlay-editing { outline: none; }
.dp-overlay-editing .dp-callout { cursor: move; }
.dp-overlay-editing .dp-callout.dp-picked { box-shadow: 0 0 0 2px #1f5fa8; }
/* The end of the leader line, so what a callout points at can be moved too. */
.dp-callout-handle {
  position: absolute; transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 50%;
  background: #fff; border: 1.5px solid #1f5fa8; cursor: move;
}

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
.dp-tabbar-spacer { flex: 1; }
.dp-tabbar-toggle {
  border: none; background: transparent; cursor: pointer;
  color: #5a6270; padding: 0.55em 0.9em; white-space: nowrap;
}
.dp-tabbar-toggle[aria-pressed="true"] { color: #1f5fa8; font-weight: 600; }
`;
