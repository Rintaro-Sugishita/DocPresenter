import { describe, expect, it } from 'vitest';
import { inlineOf, runsOf } from '../src/runs.js';

describe('セルの書き方と Excel のリッチテキスト', () => {
  it.each([
    '**太字**と*斜体*と`code`',
    '~~H~2~O~~',
    'x^2^ と H~2~O',
    '[赤]{color=#c62828}の[下線]{.underline}',
    '[**赤い太字**]{color=#c62828}',
    'a^b\\ c^',
  ])('%s は往復しても同じ書き方に戻る', text => {
    expect(inlineOf(runsOf(text))).toBe(text);
  });

  it('印の入れ子の順が違っても、同じ見た目に戻る', () => {
    const text = '~~[消した赤]{color=#c62828}~~';
    expect(runsOf(inlineOf(runsOf(text)))).toEqual(runsOf(text));
  });

  it('Excel で打った記号は、印にならないよう逃がす', () => {
    const typed = [{ text: '2*3*4 と a~b~c', bold: false, italic: false, code: false, colour: undefined }];
    const written = inlineOf(typed);
    expect(written).toBe('2\\*3\\*4 と a\\~b\\~c');
    expect(runsOf(written).map(run => run.text).join('')).toBe('2*3*4 と a~b~c');
  });

  it('端の空白は印の外に出す', () => {
    expect(inlineOf([{ text: ' 強調 ', bold: true, italic: false, code: false, colour: undefined }])).toBe(' **強調** ');
  });
});
