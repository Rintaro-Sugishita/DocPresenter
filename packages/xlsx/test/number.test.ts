import { describe, expect, it } from 'vitest';
import { asNumber, formatNumber } from '../src/number.js';

describe('数値として出すセル', () => {
  it.each([
    ['120', 120, 'General'],
    ['-3', -3, 'General'],
    ['0', 0, 'General'],
    ['0.5', 0.5, 'General'],
    ['-0.5', -0.5, 'General'],
    ['1.50', 1.5, '0.00'],
    ['0.00', 0, '0.00'],
    ['1,000', 1000, '#,##0'],
    ['12,345,678', 12345678, '#,##0'],
    ['1,234.50', 1234.5, '#,##0.00'],
    ['50%', 0.5, '0%'],
    ['12.5%', 0.125, '0.0%'],
    ['2026', 2026, 'General'],
    ['123456789012345', 123456789012345, 'General'],
  ])('%s は数値 %s、表示形式 %s', (text, value, format) => {
    expect(asNumber(text)).toEqual({ value, format });
  });

  it.each([
    '001', '0312345678', '.5', '5.', '+5', '1,00', '10,0000', '１２３', '1e5',
    '¥1,000', '$5', '10件', '3px', '(1,000)', '▲500', '1-2', '2026/11/16', '12:30',
    '1234567890123456', '#', '^', '—', '-0', '-0.00', '', 'ログイン ID', '1 000',
  ])('%s は文字列のまま', text => {
    expect(asNumber(text)).toBeUndefined();
  });

  it('数値にしたものは、表示形式で元の文字に戻る', () => {
    for (const text of ['120', '1.50', '0.00', '1,234.50', '12.5%', '50%', '-0.5', '0.125']) {
      const number = asNumber(text)!;
      expect(formatNumber(number.value, number.format)).toBe(text);
    }
  });
});

describe('Excel の表示形式で見た目どおりに戻す', () => {
  it('標準・桁区切り・小数の桁・%', () => {
    expect(formatNumber(42, 'General')).toBe('42');
    expect(formatNumber(0.1 + 0.2, 'General')).toBe('0.3');
    expect(formatNumber(1234567.891, '#,##0.00')).toBe('1,234,567.89');
    expect(formatNumber(-1234, '#,##0')).toBe('-1,234');
    expect(formatNumber(0.075, '0.0%')).toBe('7.5%');
  });

  it('日付と時刻（Excel が勝手に日付にしたもの）', () => {
    // 2026-01-02 は 1900 年方式で 46024
    expect(formatNumber(46024, 'yyyy/m/d')).toBe('2026/1/2');
    expect(formatNumber(46024, 'm"月"d"日"')).toBe('1月2日');
    expect(formatNumber(46024.5, 'h:mm')).toBe('12:00');
    expect(formatNumber(46024, 'yyyy"年"m"月"d"日"')).toBe('2026年1月2日');
  });

  it('単位の付いた表示形式は、その文字ごと戻す', () => {
    expect(formatNumber(3, '0"件"')).toBe('3件');
  });
});
