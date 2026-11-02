// The canvas's own chrome. It is not part of a theme: a theme styles the
// drawing, and the drawing must look the same on screen as it does in the
// PDF. Everything here sits over the picture, never in it.

export const DIAGRAM_STYLE = `
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
/* The look of the picked line. Same row, same buttons; what is on now is
   marked rather than disabled, because it is a state and not a dead end. */
.dp-canvas-liners { display: inline-flex; gap: 1px; align-items: center; }
/* 矢印の 4 つと太さの 3 つは別のことを決めるので、間を空ける。 */
.dp-canvas-liners .dp-canvas-icon:nth-child(5) { margin-left: 7px; }
.dp-canvas-liners[hidden] { display: none; }
.dp-canvas-on { background: #dce6f2; border-color: #9cb4d0; }
/* 一覧の行のボタン。行が選ばれているときだけ出る。 */
.dp-canvas-rows { display: inline-flex; gap: 1px; align-items: center; }
/* 深さの 2 つと状態の 2 つは別のことを決めるので、間を空ける。 */
.dp-canvas-rows .dp-canvas-icon:nth-child(3) { margin-left: 7px; }
.dp-canvas-rows .dp-canvas-icon:nth-child(5) { margin-left: 7px; }
.dp-canvas-rows[hidden] { display: none; }
/* 入れ物の中で落とす先。隙間に出る帯と、入れ替える相手への被せ。 */
.dp-canvas-drop { fill: #2f6fb5; opacity: 0.35; }
.dp-canvas-stage { outline: none; position: relative; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
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
/* 行の文字は左から始まるので、行の入力欄だけは中央寄せをやめる。 */
.dp-canvas-row-text { text-align: left; min-width: 2em; }
.dp-canvas-stage:focus-visible { box-shadow: 0 0 0 2px #cfe0f5; }
.dp-canvas-stage [data-node] { cursor: move; }
.dp-canvas-outline {
  fill: rgba(31, 95, 168, 0.12); stroke: #1f5fa8; stroke-width: 1.5; pointer-events: none;
}
.dp-canvas-handle { fill: #fff; stroke: #1f5fa8; stroke-width: 1.5; cursor: nwse-resize; }
/* The edge between a form's labels and its inputs. */
.dp-canvas-column { fill: #1f5fa8; fill-opacity: .35; cursor: col-resize; }
.dp-canvas-column:hover { fill-opacity: .7; }
/* The picked row of a tree, a list or a menu. An outline and no fill: the row
   is still part of the picture, and the words under it have to stay readable. */
.dp-canvas-row {
  fill: none; stroke: #1f5fa8; stroke-width: 1.4; stroke-dasharray: 4 2;
  pointer-events: none;
}
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
/* A link that is not drawn (\`~~~\`) is shown faintly here only, so it can be
   picked and deleted. */
.dp-canvas .dp-line-invisible :is(polyline, .dp-edge-line) { stroke-dasharray: 2 4; opacity: 0.4; }
.dp-overlay-editing { outline: none; }
.dp-overlay-editing .dp-callout { cursor: move; }
.dp-overlay-editing .dp-callout.dp-picked { box-shadow: 0 0 0 2px #1f5fa8; }
/* The end of the leader line, so what a callout points at can be moved too. */
.dp-callout-handle {
  position: absolute; transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 50%;
  background: #fff; border: 1.5px solid #1f5fa8; cursor: move;
}
`;
