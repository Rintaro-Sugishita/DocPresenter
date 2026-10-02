// The chrome both editors share: the formatting bar, the colour swatches
// and the context menu. A drawing and a document are edited in different
// ways, but these three are the same in both, so they are styled once.

export const BASE_STYLE = `
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


/* The context menu. It sits on the document, not inside the grid, so nothing
   it opens over can clip it. */
.dp-menu {
  position: fixed; z-index: 20; min-width: 11em;
  background: #fff; border: 1px solid #c8ccd2; border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0,0,0,.18); padding: 4px;
  font-family: system-ui, sans-serif; font-size: 13px;
  /* 候補が増えても画面からはみ出さない。はみ出した先は誰にも押せない。
     画面いっぱいまで伸ばすとメニューに見えなくなるので、そこで止めて送る。 */
  max-height: min(70vh, 34em); overflow-y: auto; overscroll-behavior: contain;
}
/* 区分は「開く行」にする。見出しを並べるだけでは、結局その下の全部を送って
   見ることになる。開いた先は親の行の横に出て、親より高くまで使える——親は
   上の段に戻るための短い一覧だから止めてよいが、こちらは一区分ぶんある。 */
.dp-menu-sub { z-index: 21; max-height: min(92vh, 40em); }
.dp-menu button {
  display: block; width: 100%; text-align: left;
  border: none; background: transparent; color: #3a4048; cursor: pointer;
  padding: 0.4em 0.8em; border-radius: 3px; font: inherit;
}
.dp-menu button:hover, .dp-menu button:focus { background: #eceef1; outline: none; }
.dp-menu button:disabled { color: #b6bcc5; cursor: default; background: transparent; }
/* 開く行。矢印は「ここから先がある」ことを言う。 */
.dp-menu button.dp-menu-more { position: relative; padding-right: 1.7em; }
.dp-menu button.dp-menu-more::after {
  content: '\\203a'; position: absolute; right: 0.65em; top: 50%;
  transform: translateY(-50%); color: #8b929c; font-size: 1.15em; line-height: 1;
}
.dp-menu button.dp-menu-more[aria-expanded="true"] { background: #eceef1; }
/* A disabled first item is the explanation above a choice, not a choice. */
.dp-menu button:disabled:first-child { color: #6b7280; font-size: 0.92em; }
.dp-menu-icon {
  display: inline-flex; width: 18px; margin-right: 0.5em; color: #5a6270; vertical-align: -3px;
}
.dp-menu-rule { height: 1px; background: #e2e4e8; margin: 4px 2px; }
`;
