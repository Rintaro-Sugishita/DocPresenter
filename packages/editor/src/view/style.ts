// The document editor's own chrome: the page, the blocks, the table grid
// and the sheet tabs. The parts it shares with the drawing editor are in
// the base package, and the canvas's parts are in the diagram package.

export const EDITOR_STYLE = `
/* The editor is as wide as the place it is given, whatever is in it: the tab
   bar of a long document scrolls on its own rather than widening the editor,
   which would push the page — and the buttons at its edges — out of view. */
.dp-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; contain: inline-size; background: #f4f5f7; }
.dp-editor-pane { flex: 1; overflow: auto; padding: 2.5em 0; }
.dp-editor-pane > .dp-page {
  background: #fff; max-width: 48em; margin: 0 auto 2em;
  /* The left margin is wider: heading numbers hang in it, and the ＋ that adds
     between blocks sits in it. The width of the text is the same. */
  padding: 3em 3.5em 3em 5.5em; box-shadow: 0 1px 4px rgba(0,0,0,.12);
}
/* Heading numbers hang in the margin, so the structure reads down the left
   edge and nothing below a heading is indented — the text keeps its width.
   The screen's own: what is printed is laid out by the theme. */
.dp-editor-pane .dp-page :is(h2, h3, h4) { position: relative; }
.dp-editor-pane .dp-page :is(h2, h3, h4) > .dp-number:first-child {
  position: absolute; right: 100%; margin-right: 0.6em; white-space: nowrap;
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

/* What @ and @import "…" can be followed by, under the text box being written. */
.dp-suggest {
  position: absolute; left: 0; top: 100%; z-index: 20; margin: 2px 0 0; padding: 2px 0;
  list-style: none; min-width: 16em; max-width: 100%; max-height: 14em; overflow: auto;
  background: #fff; border: 1px solid #c9ced6; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.15);
  font-family: var(--font-heading, sans-serif); font-size: 0.85em; line-height: 1.5;
}
.dp-suggest[hidden] { display: none; }
.dp-suggest li { display: flex; gap: 1em; justify-content: space-between; padding: 0.15em 0.7em; cursor: pointer; }
.dp-suggest li.dp-suggest-active { background: #e8eefc; }
.dp-suggest-text { font-family: var(--font-mono, monospace); white-space: nowrap; }
.dp-suggest-detail { color: #6b7380; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Where a new block begins. An empty sheet says so; a sheet with content
   keeps it quiet until the pointer is over it. */
.dp-append {
  cursor: text; min-height: 0.9em; padding: 0.15em 0;
  display: flex; align-items: center; gap: 0.5em;
  font-family: var(--font-heading, sans-serif); font-size: 0.85em;
  color: #a7aeb8; position: relative;
}
/* The end of a sheet opens up under the pointer. */
.dp-append:not(.dp-append-gap):hover { min-height: 1.8em; }
/* Between two blocks it takes no room: the page is spaced as it is for
   reading. A ＋ in the margin shows while the pointer is on the block above. */
.dp-append.dp-append-gap:not(.dp-editing) {
  display: block; height: 0; min-height: 0; padding: 0; font-size: inherit; cursor: default;
}
.dp-append-zone {
  position: absolute; left: -5.2em; width: 2.6em; top: -14px; height: 28px; z-index: 3;
  display: flex; align-items: center; justify-content: center;
}
.dp-append-plus {
  width: 22px; height: 22px; padding: 0; border-radius: 50%; cursor: pointer;
  border: 1px solid #c9ced6; background: #fff; color: #5a6270;
  font: 16px/20px system-ui, sans-serif; text-align: center;
  /* It stays a moment after the pointer leaves, long enough to reach it. */
  opacity: 0; transition: opacity .12s .35s;
}
[data-span]:hover + .dp-append-gap .dp-append-plus,
.dp-append-gap:hover .dp-append-plus,
.dp-append-gap.dp-append-over .dp-append-plus { opacity: 1; transition-delay: 0s; }
.dp-append-plus:hover, .dp-append-plus:focus-visible {
  border-color: #1f5fa8; color: #1f5fa8; background: #eef3fa; outline: none;
}
/* A finger has no hover: the ＋ stays shown, quietly. */
@media (hover: none) {
  .dp-append-plus { opacity: .6; transition: none; }
}
/* A narrow screen cannot spare the margin: numbers stay in the heading and
   the ＋ moves into what margin there is. */
@media (max-width: 640px) {
  .dp-editor-pane > .dp-page { padding: 1.5em 1.2em 1.5em 2.6em; }
  .dp-editor-pane .dp-page :is(h2, h3, h4) > .dp-number:first-child { position: static; margin-right: 0.4em; }
  .dp-append-zone { left: -2.5em; width: 2.4em; }
}
/* Where the addition goes, while the ＋ is pointed at or a picture is held over it. */
.dp-append-gap:has(.dp-append-zone:hover)::after,
.dp-append-gap.dp-append-over::after {
  content: ''; position: absolute; left: 0; right: 0; top: -1px;
  border-top: 2px solid #1f5fa8; opacity: .55; pointer-events: none;
}
.dp-sheet > .dp-append:last-child { min-height: 1.8em; padding: 0.5em 0; }
.dp-append-hint { flex: 0 0 auto; }
/* The hint's room is kept even while it is hidden: if it only took space on
   hover, the buttons would jump aside under the pointer and the press meant
   for them would land on the hint, opening the text instead. */
.dp-append-hint:empty::before { content: attr(data-hint); visibility: hidden; }
.dp-append:hover .dp-append-hint:empty::before { visibility: visible; }
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
/* Mermaid: which of the drawing and its code the reader sees. Shown on the
   block the pointer is over, and always while one of them is focused. */
.dp-mermaid { position: relative; }
.dp-mermaid-switch {
  position: absolute; top: 4px; right: 4px; z-index: 2; display: flex;
  font-family: system-ui, sans-serif; font-size: 12px;
  background: #fff; border: 1px solid #c9ced6; border-radius: 4px; overflow: hidden;
  opacity: 0; transition: opacity 0.12s;
}
.dp-mermaid:hover > .dp-mermaid-switch, .dp-mermaid-switch:focus-within { opacity: 1; }
.dp-mermaid-choice {
  border: 0; background: none; padding: 3px 9px; cursor: pointer; color: #3a4048; font: inherit;
}
.dp-mermaid-choice + .dp-mermaid-choice { border-left: 1px solid #c9ced6; }
.dp-mermaid-choice[aria-pressed="true"] { background: #1f5fa8; color: #fff; }
.dp-mermaid-choice:focus-visible { outline: 2px solid #1f5fa8; outline-offset: -2px; }
/* A figure's names: its file, its caption, its label. The button shows on the
   figure the pointer is over; the form is laid over the editor. */
.dp-figure { position: relative; }
.dp-figure-tools {
  position: absolute; top: 4px; right: 4px; z-index: 3; display: flex; gap: 4px;
  opacity: 0; transition: opacity 0.12s;
}
.dp-figure:hover > .dp-figure-tools, .dp-figure-tools:focus-within { opacity: 1; }
/* The zoom bar would sit where these buttons are, over them; on a figure in
   the editor it goes to the bottom corner instead. */
.dp-figure > .dp-figure-body > .dp-zoom-bar { top: auto; bottom: 4px; }
/* While a drawing or a table is open, its own bar runs along the top, where
   these buttons would sit over its buttons: they move just above the figure. */
.dp-figure:has(.dp-canvas, .dp-canvas-host, .dp-grid) > .dp-figure-tools { top: auto; bottom: 100%; margin-bottom: 4px; }
.dp-figure-names, .dp-figure-delete {
  font: 11px system-ui, sans-serif; color: #3a4048; cursor: pointer;
  background: #fff; border: 1px solid #c9ced6; border-radius: 3px; padding: 2px 8px;
}
.dp-figure-names:hover { border-color: #1f5fa8; color: #1f5fa8; }
.dp-figure-delete:hover { border-color: #b3261e; color: #b3261e; }
.dp-figure-names:focus-visible, .dp-figure-delete:focus-visible { outline: 2px solid #1f5fa8; outline-offset: 1px; }
.dp-names-backdrop {
  position: fixed; inset: 0; z-index: 50; background: rgba(20, 24, 31, .35);
  display: flex; align-items: flex-start; justify-content: center; padding: 10vh 16px 0;
}
.dp-names {
  width: min(520px, 100%); box-sizing: border-box; background: #fff; color: #1f2329;
  border-radius: 6px; box-shadow: 0 10px 30px rgba(0, 0, 0, .25); padding: 18px 20px 14px;
  font: 13px system-ui, sans-serif;
}
.dp-names-title { font-size: 15px; margin: 0 0 12px; }
.dp-names-field { display: block; margin-bottom: 12px; }
.dp-names-label { display: block; font-weight: 600; margin-bottom: 4px; }
.dp-names-line { display: flex; align-items: center; gap: 4px; }
.dp-names-fixed { color: #6b7280; font-family: ui-monospace, monospace; white-space: nowrap; }
.dp-names-input {
  flex: 1; min-width: 0; font: inherit; padding: 5px 7px;
  border: 1px solid #c9ced6; border-radius: 3px;
}
.dp-names-input:focus { outline: 2px solid #1f5fa8; outline-offset: -1px; border-color: #1f5fa8; }
.dp-names-input:disabled { background: #f3f4f6; color: #6b7280; }
.dp-names-hint { display: block; color: #6b7280; font-size: 12px; margin-top: 3px; }
.dp-names-problem { color: #b3261e; margin: 0 0 10px; }
.dp-names-buttons { display: flex; justify-content: flex-end; gap: 8px; }
.dp-names-buttons button {
  font: inherit; padding: 5px 14px; border-radius: 3px; cursor: pointer;
  border: 1px solid #c9ced6; background: #f7f8fa; color: #3a4048;
}
.dp-names-buttons .dp-names-ok { background: #1f5fa8; border-color: #1f5fa8; color: #fff; }
.dp-delete-path { margin: -6px 0 12px; color: #6b7280; font-family: ui-monospace, monospace; word-break: break-all; }
.dp-delete-choice { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 10px; cursor: pointer; }
.dp-delete-choice input { margin-top: 3px; }
.dp-delete-choice input:disabled + .dp-delete-words { color: #9aa1ab; }
.dp-delete-warn { color: #8a5a00; background: #fdf6e3; border-radius: 3px; padding: 6px 8px; margin: 0 0 10px; }
.dp-names-buttons .dp-names-ok.dp-delete-danger { background: #b3261e; border-color: #b3261e; }
/* Review comments on the page: the words they are about, and the card that
   shows the comment under the pointer. A comment whose text changed since is
   drawn dashed, so it reads as "this may no longer apply". */
mark.dp-review-mark {
  background: rgba(255, 196, 0, .32); color: inherit; border-bottom: 2px solid #e0a800;
  padding: 0; cursor: help;
}
mark.dp-review-mark[data-review-state="changed"] { background: rgba(255, 196, 0, .16); border-bottom-style: dashed; }
.dp-review-block { outline: 2px solid rgba(224, 168, 0, .8); outline-offset: 3px; cursor: help; }
.dp-review-block[data-review-state="changed"] { outline-style: dashed; }
text.dp-review-svg, .dp-review-svg text { fill: #8a5a00; font-weight: 700; }
.dp-review-card {
  position: fixed; z-index: 60; max-width: 360px; box-sizing: border-box;
  background: #fff; color: #1f2329; border: 1px solid #d3d7dd; border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .18); padding: 8px 10px; font: 12px/1.5 system-ui, sans-serif;
  pointer-events: none;
}
.dp-review-item + .dp-review-item { border-top: 1px solid #eceef1; margin-top: 6px; padding-top: 6px; }
.dp-review-head { color: #6b7280; margin-bottom: 2px; }
.dp-review-body { white-space: pre-wrap; }
.dp-review-changed { color: #8a5a00; margin-top: 4px; }
.dp-review-reply { margin-top: 4px; padding-left: 8px; border-left: 3px solid #c3d3e6; color: #3a4048; white-space: pre-wrap; }
/* A comment on a shape of a drawing: the shape's outline, not only its words. */
/* The theme draws every shape's outline from .dp-diagram .dp-node, so these say .dp-diagram too. */
.dp-diagram .dp-review-node > rect, .dp-diagram .dp-review-node > ellipse,
.dp-diagram .dp-review-node > polygon, .dp-diagram .dp-review-node > path {
  stroke: #e0a800; stroke-width: 2.5px;
}
.dp-diagram .dp-review-node[data-review-state="changed"] > * { stroke-dasharray: 5 3; }
.dp-diagram .dp-review-node { cursor: help; }
.dp-diagram .dp-review-node.dp-review-lit > rect, .dp-diagram .dp-review-node.dp-review-lit > ellipse,
.dp-diagram .dp-review-node.dp-review-lit > polygon, .dp-diagram .dp-review-node.dp-review-lit > path {
  stroke: #c27c00; stroke-width: 3.5px;
}
mark.dp-review-mark.dp-review-lit { background: rgba(255, 196, 0, .62); }
.dp-review-block.dp-review-lit { outline-color: #c27c00; outline-width: 3px; }
/* The bubbles: comments that stay on the page. Those on words go in a margin
   to the right of the page, so the pane keeps room for it; those on a shape
   sit beside the shape, pointing at it. */
.dp-editor-pane > .dp-page { position: relative; }
.dp-editor-pane.dp-with-bubbles { padding-right: 262px; }
.dp-review-bubbles-margin { position: absolute; top: 0; left: calc(100% + 14px); width: 232px; }
.dp-review-bubbles-figure { position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 4; }
.dp-review-bubble {
  position: absolute; box-sizing: border-box; text-align: left;
  background: #fffbea; color: #1f2329; border: 1px solid #e3c35a; border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .12); padding: 6px 8px;
  font: 12px/1.45 system-ui, sans-serif; cursor: pointer;
}
.dp-review-bubble:hover, .dp-review-bubble.dp-review-lit { z-index: 6; border-color: #c27c00; box-shadow: 0 4px 14px rgba(0, 0, 0, .2); }
.dp-review-bubble-margin { left: 0; right: 0; }
.dp-review-bubble-node { width: max-content; max-width: 240px; }
.dp-review-bubble .dp-review-body {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden;
}
.dp-review-bubble:hover .dp-review-body { -webkit-line-clamp: unset; }
.dp-review-bubble .dp-review-reply { display: none; }
.dp-review-bubble:hover .dp-review-reply { display: block; }
.dp-review-bubble .dp-review-item[data-status="resolved"], .dp-review-bubble .dp-review-item[data-status="wontfix"] { opacity: .6; }
.dp-review-bubble::before {
  content: ""; position: absolute; width: 10px; height: 10px; box-sizing: border-box;
  background: #fffbea; border: 1px solid #e3c35a; border-width: 0 0 1px 1px;
}
.dp-review-bubble:hover::before, .dp-review-bubble.dp-review-lit::before { border-color: #c27c00; }
/* The author's own notes are blue; the review findings, yellow. */
.dp-review-bubble-comment, .dp-review-bubble-comment::before { background: #eef5ff; border-color: #8fb4e3; }
.dp-review-bubble-comment:hover, .dp-review-bubble-comment.dp-review-lit,
.dp-review-bubble-comment:hover::before, .dp-review-bubble-comment.dp-review-lit::before { border-color: #3d73b9; }
.dp-review-bubble-margin::before { left: -6px; top: 9px; transform: rotate(45deg); }
.dp-review-bubble-above::before { left: var(--tail, 12px); bottom: -6px; transform: rotate(-45deg); }
.dp-review-bubble-below::before { left: var(--tail, 12px); top: -6px; transform: rotate(135deg); }
/* Reading (the review mode): nothing on the page offers to change the file. */
.dp-readonly .dp-append, .dp-readonly .dp-figure-tools, .dp-readonly .dp-tab-add,
.dp-readonly .dp-tab-close, .dp-readonly .dp-import-line, .dp-readonly .dp-mermaid-switch { display: none; }
.dp-readonly .dp-editor-pane { cursor: text; }
/* Copying a code block. In its header, beside the language. */
.dp-code-copy {
  margin-left: auto; font: 11px system-ui, sans-serif; color: #3a4048; cursor: pointer;
  background: #fff; border: 1px solid #c9ced6; border-radius: 3px; padding: 1px 8px;
}
.dp-code-copy:hover { border-color: #1f5fa8; color: #1f5fa8; }
.dp-code-copy:focus-visible { outline: 2px solid #1f5fa8; outline-offset: 1px; }

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
/* A cell that takes its words from a list: the button that opens it, over the
   text box, and the list under the cell. A word the screen cannot read is
   underlined where it is written. */
.dp-grid-opener {
  position: absolute; top: 2px; right: 2px; bottom: 2px; z-index: 2; width: 1.4em; padding: 0;
  border: none; border-radius: 3px; background: #e8eefc; color: #1f5fa8; cursor: pointer; font: inherit; line-height: 1;
}
/* As wide as its words, not as the column: a narrow 型 column would cut every
   choice short. */
.dp-grid-choices { min-width: 12em; max-width: none; width: max-content; font-weight: 400; text-align: left; }
.dp-grid-choices.dp-grid-choices-up { top: auto; bottom: 100%; margin: 0 0 2px; }
.dp-grid-table .dp-grid-unread .dp-grid-text { text-decoration: underline wavy #b3261e; }

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
  /* A tab keeps its width; when they do not all fit, the bar scrolls. */
  flex: 0 0 auto;
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
.dp-append-over:not(.dp-append-gap) { min-height: 1.8em; background: rgba(31, 95, 168, .10); outline: 1px dashed #1f5fa8; }

.dp-tabbar-spacer { flex: 1; }
.dp-tabbar-toggle {
  /* Held at the right end while the tabs scroll under it: a bar too narrow
     for every tab must not hide the switch between one sheet and all. */
  position: sticky; right: 0; flex: 0 0 auto;
  box-shadow: -6px 0 6px -4px rgba(0, 0, 0, .15);
  border: none; background: #e9ebef; cursor: pointer;
  color: #5a6270; padding: 0.55em 0.9em; white-space: nowrap;
}
.dp-tabbar-toggle[aria-pressed="true"] { color: #1f5fa8; font-weight: 600; }
/* A long press opens our menu (enableLongPress); the platform's own callout
   and text selection would open on top of it. */
.dp-grid, .dp-tabbar, .dp-figure { -webkit-touch-callout: none; }
.dp-grid, .dp-tabbar { -webkit-user-select: none; user-select: none; }
`;
