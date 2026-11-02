import { describe, expect, it } from 'vitest';
import { columnFloor, fitColumns, parseLength } from '../src/column-widths.js';

describe('列幅の割り振り', () => {
  it('幅の書き方を読む', () => {
    expect(parseLength('18%')).toEqual({ value: 18, unit: '%' });
    expect(parseLength('4em')).toEqual({ value: 4, unit: 'em' });
    expect(parseLength('1.5rem')).toEqual({ value: 1.5, unit: 'em' });
    expect(parseLength('120')).toEqual({ value: 120, unit: 'px' });
    expect(parseLength('auto')).toBeUndefined();
  });

  it('見出しは折らず、英数字の語は 1 語ぶん、和文は折れる', () => {
    expect(columnFloor('ID', ['keepBox', 'idBox'])).toBeCloseTo(7 * 0.6 + 1.1);
    expect(columnFloor('項目名', ['ログイン状態を保持'])).toBeCloseTo(3 + 1.1);
    expect(columnFloor('No', ['1'])).toBeCloseTo(2 + 1.1);
  });

  it('残りで足りるなら、書かれたとおりにする', () => {
    expect(fitColumns(['20%', undefined, undefined], [3, 3], 1000, 16)).toBeUndefined();
    expect(fitColumns([undefined, undefined], [3, 3], 1000, 16)).toBeUndefined();
  });

  it('全部の列に幅があれば、書かれたとおりにする', () => {
    expect(fitColumns(['60%', '60%'], [3, 3], 1000, 16)).toBeUndefined();
  });

  it('幅の無い列が潰れるなら、その列に要るぶんを空け、書かれた幅を同じ割合で縮める', () => {
    // 項目一覧と同じ形：分類 18%・説明 38%・必須 4em・初期値 5em と、幅の無い 5 列
    const widths = ['18%', undefined, undefined, undefined, undefined, '4em', undefined, '5em', '38%'];
    const floors = widths.map(() => 5);
    const shares = fitColumns(widths, floors, 680, 16)!;
    expect(shares).toBeDefined();
    for (const c of [1, 2, 3, 4, 6]) expect(shares[c]! / 100 * 680).toBeGreaterThanOrEqual(5 * 16 - 1);
    expect(shares[0]! / shares[8]!).toBeCloseTo(18 / 38, 1);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });

  it('読めない幅があれば手を出さない', () => {
    expect(fitColumns(['calc(10% + 2em)', undefined], [3, 3], 100, 16)).toBeUndefined();
  });
});
