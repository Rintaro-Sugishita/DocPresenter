import { describe, expect, it } from 'vitest';
import { applyEdit, byteLength, type Edit } from '@docpresenter/base';
import { createHistory, differingRange, redoing, undoing, undoKey, type Step } from '../src/index.js';

const edit = (change: { span: Edit['span']; text: string }): Edit => ({ ...change, description: '' });

const step = (before: string, after: string, description = '編集'): Step =>
  ({ path: undefined, before, after, description, sheet: 1 });

describe('違う範囲', () => {
  it('前後の共通部分には触らない', () => {
    const change = differingRange('ab図形cd', 'ab四角cd');
    expect(change.text).toBe('四角');
    expect(change.span).toEqual({ start: 2, end: 2 + byteLength('図形') });
  });

  it('書き戻すと元に戻る（挿入・削除・置換）', () => {
    const pairs: [string, string][] = [
      ['web -> db\n', 'web -> db\napp -> db\n'],
      ['a\nb\nc\n', 'a\nc\n'],
      ['画面の項目', '画面の入力項目'],
      ['', 'すべて新しい'],
      ['同じ', '同じ'],
    ];
    for (const [from, to] of pairs) {
      expect(applyEdit(from, edit(differingRange(from, to)))).toBe(to);
      expect(applyEdit(to, edit(differingRange(to, from)))).toBe(from);
    }
  });

  it('サロゲートペアを割らない', () => {
    const change = differingRange('前😀後', '前😃後');
    expect(change.text).toBe('😃');
    expect(applyEdit('前😀後', edit(change))).toBe('前😃後');
  });

  it('同じ字が続く所でも範囲は 1 つ', () => {
    const change = differingRange('aaaa', 'aaaaa');
    expect(applyEdit('aaaa', edit(change))).toBe('aaaaa');
    expect(byteLength(change.text)).toBe(1);
  });
});

describe('取り消しの可否', () => {
  it('ファイルがそのときのままなら戻せる', () => {
    expect(undoing(step('a', 'b'), 'b')).toBeDefined();
    expect(redoing(step('a', 'b'), 'a')).toBeDefined();
  });

  it('あとで書き換えられていれば戻さない', () => {
    expect(undoing(step('a', 'b'), 'c')).toBeUndefined();
    expect(redoing(step('a', 'b'), 'c')).toBeUndefined();
    expect(undoing(step('a', 'b'), undefined)).toBeUndefined();
  });
});

describe('履歴', () => {
  it('取り消した順にやり直せる', () => {
    const history = createHistory();
    history.record(step('', 'a', '1'));
    history.record(step('a', 'ab', '2'));
    expect(history.nextUndo()?.description).toBe('2');
    history.undone();
    expect(history.nextUndo()?.description).toBe('1');
    expect(history.nextRedo()?.description).toBe('2');
    history.redone();
    expect(history.nextUndo()?.description).toBe('2');
    expect(history.nextRedo()).toBeUndefined();
  });

  it('新しい編集でやり直しの側は消える', () => {
    const history = createHistory();
    history.record(step('', 'a'));
    history.undone();
    history.record(step('', 'b'));
    expect(history.nextRedo()).toBeUndefined();
  });

  it('何も変えなかった編集は積まない', () => {
    const history = createHistory();
    history.record(step('a', 'a'));
    expect(history.nextUndo()).toBeUndefined();
  });

  it('上限を超えた古いものから忘れる', () => {
    const history = createHistory(2);
    history.record(step('', 'a', '1'));
    history.record(step('a', 'b', '2'));
    history.record(step('b', 'c', '3'));
    history.undone();
    history.undone();
    expect(history.nextUndo()).toBeUndefined();
    expect(history.nextRedo()?.description).toBe('2');
  });
});

describe('キー', () => {
  const press = (key: string, more: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    undoKey({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...more });

  it('Ctrl+Z は取り消し、Ctrl+Y と Ctrl+Shift+Z はやり直し', () => {
    expect(press('z', { ctrlKey: true })).toBe('undo');
    expect(press('Z', { ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(press('y', { ctrlKey: true })).toBe('redo');
    expect(press('z', { metaKey: true })).toBe('undo');
  });

  it('修飾キーが無ければ、または Alt 付きなら何もしない', () => {
    expect(press('z')).toBeUndefined();
    expect(press('z', { ctrlKey: true, altKey: true })).toBeUndefined();
  });
});
