// The table settings stand for the CLI's --raw, --no-bom and --bundle.

import { describe, expect, it } from 'vitest';
import { give } from './fake-vscode.js';
import { tableSettings } from '../src/table-export-command.js';

describe('表の書き出しの設定', () => {
  it('既定のままなら何も渡さない（記法を除く・BOM 付き・1 表 1 ファイル）', () => {
    give({});
    expect(tableSettings()).toEqual({});
  });

  it('設定を CLI の選択肢と同じ意味で渡す', () => {
    give({}, { 'tables.raw': true, 'tables.bom': false, 'tables.bundle': true });
    expect(tableSettings()).toEqual({ raw: true, bom: false, bundle: true });
  });
});
