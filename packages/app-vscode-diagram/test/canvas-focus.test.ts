// The canvas takes the keyboard only when it is the one being used: a redraw
// for text typed beside it leaves the focus in the text editor.

import { describe, expect, it } from 'vitest';
import { takesFocus } from '../src/webview/focus.js';

describe('キャンバスのフォーカス', () => {
  it('テキスト側で打った変更の描き直しでは、フォーカスを取らない', () => {
    expect(takesFocus({ pageFocused: false, canvasFocused: false, first: false })).toBe(false);
  });

  it('横に開いた直後（preserveFocus）は、最初の描画でも取らない', () => {
    expect(takesFocus({ pageFocused: false, canvasFocused: false, first: true })).toBe(false);
  });

  it('キャンバスを操作中の描き直しでは、フォーカスを戻す', () => {
    expect(takesFocus({ pageFocused: true, canvasFocused: true, first: false })).toBe(true);
  });

  it('その場で開いてキャンバスに来たときは、最初の描画で取る', () => {
    expect(takesFocus({ pageFocused: true, canvasFocused: false, first: true })).toBe(true);
  });
});
