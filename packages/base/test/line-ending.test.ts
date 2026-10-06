// Line endings. A range has to mean the same thing on a CRLF checkout as on an
// LF one, because a review comment is anchored to one (design/review-model.md §3).

import { describe, expect, it } from 'vitest';
import {
  applyEdit, byteLength, lineEndingOf, replaceBytes, spanInFile, toLf, withLineEnding,
} from '../src/index.js';

const LF = 'free {\n  a [あいう]\n}\n\nlayout {\n  a @ (10, 20)\n}\n';
const CRLF = LF.replace(/\n/g, '\r\n');

/** The byte range of `part` in `text`. */
const spanOf = (text: string, part: string) => {
  const start = byteLength(text.slice(0, text.indexOf(part)));
  return { start, end: start + byteLength(part) };
};

describe('改行の見分け', () => {
  it('最初の改行で決める。改行が無ければ LF', () => {
    expect(lineEndingOf(LF)).toBe('\n');
    expect(lineEndingOf(CRLF)).toBe('\r\n');
    expect(lineEndingOf('1 行だけ')).toBe('\n');
  });

  it('LF にしても、CR だけの文字は残す', () => {
    expect(toLf(CRLF)).toBe(LF);
    expect(toLf('a\rb\r\n')).toBe('a\rb\n');
  });

  it('どちらの改行からでも、言われた改行に揃う', () => {
    expect(withLineEnding('a\nb\r\nc', '\r\n')).toBe('a\r\nb\r\nc');
    expect(withLineEnding('a\nb\r\nc', '\n')).toBe('a\nb\nc');
  });
});

describe('LF の上で測った範囲を、ファイルに当てる', () => {
  it('LF のファイルなら、そのまま', () => {
    const change = { span: spanOf(LF, '(10, 20)'), text: '(11, 20)' };
    expect(spanInFile(LF, change)).toEqual(change);
  });

  it('CRLF のファイルでは、前にある CR の数だけ後ろへずれる', () => {
    const change = { span: spanOf(LF, '(10, 20)'), text: '(11, 20)' };
    const there = spanInFile(CRLF, change);
    expect(there.span).toEqual(spanOf(CRLF, '(10, 20)'));
    expect(replaceBytes(CRLF, there.span.start, there.span.end, there.text))
      .toBe(CRLF.replace('(10, 20)', '(11, 20)'));
  });

  it('日本語を挟んでも、文字の境目に載る', () => {
    const change = { span: spanOf(LF, 'あいう'), text: 'かき' };
    const there = spanInFile(CRLF, change);
    expect(replaceBytes(CRLF, there.span.start, there.span.end, there.text))
      .toBe(CRLF.replace('あいう', 'かき'));
  });

  it('挿入する行は、ファイルの改行で書かれる', () => {
    const end = spanOf(LF, '  a @ (10, 20)').end;
    const change = { span: { start: end, end }, text: '\n  b @ (0, 0)' };
    const there = spanInFile(CRLF, change);
    const written = replaceBytes(CRLF, there.span.start, there.span.end, there.text);
    expect(written).toBe(CRLF.replace('  a @ (10, 20)', '  a @ (10, 20)\r\n  b @ (0, 0)'));
    // 行末に挿したものが CR と LF の間に入ると、改行が 2 つに割れる
    expect(written).not.toMatch(/\r(?!\n)/);
  });

  it('行をまたぐ範囲は、改行ごと置き換わる', () => {
    const change = { span: spanOf(LF, '}\n\nlayout'), text: '}\nlayout' };
    const there = spanInFile(CRLF, change);
    expect(replaceBytes(CRLF, there.span.start, there.span.end, there.text))
      .toBe(CRLF.replace('}\r\n\r\nlayout', '}\r\nlayout'));
  });

  it('末尾の範囲は、ファイルの末尾に当たる', () => {
    const end = byteLength(LF);
    const there = spanInFile(CRLF, { span: { start: end, end }, text: '# 追記\n' });
    expect(there.span).toEqual({ start: byteLength(CRLF), end: byteLength(CRLF) });
    expect(there.text).toBe('# 追記\r\n');
  });
});

describe('編集を当てる', () => {
  it('CRLF のファイルに LF の行を混ぜない', () => {
    const at = spanOf(CRLF, '  a @ (10, 20)').end;
    const written = applyEdit(CRLF, {
      span: { start: at, end: at }, text: '\n  b @ (0, 0)', description: '足す',
    });
    expect(written).toBe(CRLF.replace('  a @ (10, 20)', '  a @ (10, 20)\r\n  b @ (0, 0)'));
  });

  it('LF のファイルに CRLF を混ぜない', () => {
    const at = spanOf(LF, '  a @ (10, 20)').end;
    const written = applyEdit(LF, {
      span: { start: at, end: at }, text: '\r\n  b @ (0, 0)', description: '足す',
    });
    expect(written).toBe(LF.replace('  a @ (10, 20)', '  a @ (10, 20)\n  b @ (0, 0)'));
  });
});
