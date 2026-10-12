// The styles of the editor's page around the document: the bar along the top
// (modes, comment marks, export) and the review panel beside the page.
// Apart from the page so that a check can lay the screen out exactly as VS Code does.

export const PAGE_STYLE = `
  html, body { height: 100%; margin: 0; padding: 0; max-width: none; background: #fff; }
  body { display: flex; flex-direction: column; }
  .dp-main { flex: 1; min-height: 0; display: flex; }
  #editor { flex: 1; min-width: 0; min-height: 0; }
  /* 編集と閲覧（レビュー）。閲覧では本文を選んで指摘を付け、横に一覧を出す。 */
  .dp-modes { display: inline-flex; border: 1px solid #c9ced6; border-radius: 4px; overflow: hidden; }
  .dp-modes button { border: 0 !important; border-radius: 0 !important; }
  .dp-modes button + button { border-left: 1px solid #c9ced6 !important; }
  .dp-modes button[aria-pressed="true"] { background: #1f5fa8 !important; color: #fff !important; }
  .dp-marks { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .dp-marks[hidden] { display: none; }
  .dp-bar-gap { flex: 0 0 14px; }
  .dp-review-panel {
    flex: 0 0 280px; overflow: auto; border-left: 1px solid #e3e6ea; background: #fafbfc;
    font: 12px/1.5 system-ui, sans-serif; color: #1f2329; padding: 8px 10px; box-sizing: border-box;
  }
  .dp-review-panel[hidden] { display: none; }
  .dp-review-panel h2 { font-size: 13px; margin: 2px 0 8px; }
  .dp-review-entry { padding: 6px 8px; border: 1px solid #e3e6ea; border-radius: 4px; background: #fff; margin-bottom: 6px; cursor: pointer; }
  .dp-review-entry:hover { border-color: #e0a800; }
  .dp-review-entry .dp-review-head { color: #6b7280; }
  .dp-review-entry .dp-review-note { color: #8a5a00; }
  .dp-review-entry[data-state="lost"] { opacity: .7; cursor: default; }
  .dp-review-controls { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e3e6ea; cursor: default; }
  .dp-review-status { display: flex; align-items: center; gap: 6px; color: #6b7280; }
  .dp-review-status select { font: inherit; padding: 1px 4px; }
  .dp-review-answer { margin-top: 6px; }
  .dp-review-answer .dp-review-reply { margin-bottom: 4px; padding-left: 8px; border-left: 3px solid #c3d3e6; white-space: pre-wrap; }
  .dp-review-answer textarea { width: 100%; box-sizing: border-box; min-height: 60px; font: inherit; padding: 4px; }
  .dp-review-answer button { font: inherit; padding: 2px 10px; border: 1px solid #c9ced6; border-radius: 3px; background: #fff; cursor: pointer; }
  .dp-review-answer .dp-review-buttons { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }
  .dp-review-answer .dp-review-save { background: #1f5fa8; border-color: #1f5fa8; color: #fff; }
  .dp-review-add {
    position: fixed; z-index: 55; font: 12px system-ui, sans-serif; padding: 4px 10px; cursor: pointer;
    background: #1f5fa8; color: #fff; border: 0; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.2);
  }
  .dp-review-form {
    position: fixed; z-index: 56; width: 320px; background: #fff; border: 1px solid #d3d7dd; border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,.2); padding: 10px; font: 12px system-ui, sans-serif; box-sizing: border-box;
  }
  .dp-review-form textarea { width: 100%; box-sizing: border-box; min-height: 72px; font: inherit; padding: 6px; border: 1px solid #c9ced6; border-radius: 3px; }
  .dp-review-form .dp-review-on { color: #6b7280; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dp-review-form .dp-review-buttons { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
  .dp-review-form button { font: inherit; padding: 3px 12px; border-radius: 4px; border: 1px solid #c9ced6; background: #fff; cursor: pointer; }
  .dp-review-form button[type="submit"] { background: #1f5fa8; border-color: #1f5fa8; color: #fff; }
  @keyframes dp-review-flash { from { background: rgba(255, 196, 0, .9); } }
  .dp-review-flash { animation: dp-review-flash 1.2s ease-out; }
  /* 書き出しのボタン。編集画面の飾りであって、文書には出ない。 */
  .dp-export {
    flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 12px;
    border-bottom: 1px solid #e3e6ea; background: #f7f8fa;
    font: 12px system-ui, sans-serif; color: #3a4048;
  }
  .dp-export-label { margin-right: 2px; }
  .dp-export button {
    font: inherit; padding: 3px 12px; border: 1px solid #c9ced6; border-radius: 4px;
    background: #fff; color: #1c1f24; cursor: pointer;
  }
  .dp-export button:hover:not(:disabled) { background: #eef3fa; border-color: #1f5fa8; }
  .dp-export button:focus-visible { outline: 2px solid #1f5fa8; outline-offset: 1px; }
  .dp-export button:disabled { color: #a7aeb8; cursor: default; }
  .dp-export-status { margin-left: 8px; color: #5a6270; }
`;
