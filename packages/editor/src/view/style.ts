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
.dp-format-token { display: inline-flex; align-items: center; gap: 0.4em; }
.dp-format-token::before {
  content: ""; width: 0.75em; height: 0.75em; border-radius: 2px;
  background: currentColor; box-shadow: 0 0 0 1px rgba(255,255,255,.35);
}
.dp-token-changed::before  { color: var(--text-changed, #8a5a00); }
.dp-token-pending::before  { color: var(--text-pending, #1f5fa8); }
.dp-token-disabled::before { color: var(--text-disabled, #767c85); }
.dp-token-removed::before  { color: var(--text-removed, #b3261e); }

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
  padding: 0.1em 0.3em; min-width: 6em;
}
.dp-tab-add { font-size: 15px; padding: 0.55em 0.8em; color: #5a6270; }
.dp-tabbar-spacer { flex: 1; }
.dp-tabbar-toggle {
  border: none; background: transparent; cursor: pointer;
  color: #5a6270; padding: 0.55em 0.9em; white-space: nowrap;
}
.dp-tabbar-toggle[aria-pressed="true"] { color: #1f5fa8; font-weight: 600; }
`;
