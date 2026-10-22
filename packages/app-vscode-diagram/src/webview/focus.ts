// When a redraw of the canvas may take the keyboard.
//
// Focusing an element inside the WebView moves VS Code's focus to the WebView.
// A redraw for a change typed in the text editor beside it must leave the
// focus where the author is typing; only a redraw of a canvas that already had
// the keyboard — or the first drawing of a canvas VS Code just focused — takes
// it back.

export interface FocusState {
  /** The WebView itself has the focus (`document.hasFocus()`). */
  readonly pageFocused: boolean;
  /** The focus was inside the canvas before the redraw replaced it. */
  readonly canvasFocused: boolean;
  /** This is the first drawing, from `open`. */
  readonly first: boolean;
}

export function takesFocus(state: FocusState): boolean {
  return state.pageFocused && (state.canvasFocused || state.first);
}
