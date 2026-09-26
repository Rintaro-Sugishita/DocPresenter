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
  cursor: text; min-height: 1.8em; padding: 0.5em 0;
  font-family: var(--font-heading, sans-serif); font-size: 0.85em;
  color: transparent; position: relative;
}
.dp-append:hover { color: #a7aeb8; }
.dp-append:hover:empty::before { content: "ここに本文を書く"; }
.dp-sheet-empty .dp-append { color: #8b929c; min-height: 3em; }
.dp-append.dp-editing, .dp-append:has(.dp-block-source) { color: inherit; font-size: inherit; }

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
.dp-grid-picker {
  width: 1.6em; height: 1.6em; padding: 0; border: 1px solid #aeb4bd;
  border-radius: 3px; background: none; cursor: pointer;
}
.dp-grid-clear {
  border: 1px solid #d3d7dd; background: #f7f8fa; color: #6b7280;
  border-radius: 3px; cursor: pointer; padding: 0 0.4em; font: inherit; font-size: 12px;
}

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
