import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import { paperOf, paperValue, setFrontmatterKey } from '../src/index.js';

describe('用紙', () => {
  it('名前と向きを読む', () => {
    expect(paperOf({ paper: 'A4' })).toEqual({ name: 'A4', orientation: 'portrait', width: 210, height: 297 });
    expect(paperOf({ paper: 'b5 landscape' })).toMatchObject({ name: 'B5', orientation: 'landscape', width: 257, height: 182 });
    expect(paperOf({ paper: 'A3', orientation: '横' })).toMatchObject({ orientation: 'landscape', width: 420 });
    expect(paperOf({ paper: 'slide' })).toMatchObject({ orientation: 'landscape', width: 338.67, height: 190.5 });
    expect(paperOf({ paper: 'はがき' })).toBeUndefined();
    expect(paperOf({})).toBeUndefined();
  });

  it('書く値は、いつもの向きなら名前だけ', () => {
    expect(paperValue('A4', 'portrait')).toBe('A4');
    expect(paperValue('A4', 'landscape')).toBe('A4 landscape');
    expect(paperValue('slide', 'landscape')).toBe('slide');
  });

  it('文書情報の 1 行を足す・書き換える・消す', () => {
    const apply = (source: string, key: string, value: string | undefined): string =>
      applyEdit(source, { ...setFrontmatterKey(source, key, value), description: '' });
    const source = '---\ntitle: 案内\npaper: A4\n---\n\n# 案内\n';
    expect(apply(source, 'paper', 'A3 landscape')).toBe('---\ntitle: 案内\npaper: A3 landscape\n---\n\n# 案内\n');
    expect(apply(source, 'paper', undefined)).toBe('---\ntitle: 案内\n---\n\n# 案内\n');
    expect(apply('# 案内\n', 'paper', 'B5')).toBe('---\npaper: B5\n---\n\n# 案内\n');
    expect(apply('---\ntitle: x\n---\n', 'paper', 'A4')).toBe('---\ntitle: x\npaper: A4\n---\n');
  });

  it('4:3 のスライドは横向きで、値はそのまま書かれる', () => {
    const paper = paperOf({ paper: 'slide-4:3' })!;
    expect(paper).toMatchObject({ name: 'slide-4:3', orientation: 'landscape', width: 254, height: 190.5 });
    expect(paperValue('slide-4:3', 'landscape')).toBe('slide-4:3');
  });
});
