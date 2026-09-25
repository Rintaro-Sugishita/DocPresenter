import { describe, expect, it } from 'vitest';
import { COMMIT_KEYS, DEFAULT_SETTINGS, isCommit, type CommitKey } from '../src/index.js';

const press = (key: string, held: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...held,
});

describe('確定キーの割り当て', () => {
  it('既定は Ctrl+Enter', () => {
    expect(DEFAULT_SETTINGS.commitKey).toBe('ctrl-enter');
  });

  it('Cmd+Enter も Ctrl+Enter として扱う', () => {
    expect(isCommit(press('Enter', { metaKey: true }), 'ctrl-enter')).toBe(true);
  });

  it('割り当てた組み合わせだけが確定になる', () => {
    const cases: [CommitKey, ReturnType<typeof press>, boolean][] = [
      ['ctrl-enter', press('Enter', { ctrlKey: true }), true],
      ['ctrl-enter', press('Enter'), false],
      ['enter', press('Enter'), true],
      ['enter', press('Enter', { shiftKey: true }), false],
      ['shift-enter', press('Enter', { shiftKey: true }), true],
      ['shift-enter', press('Enter'), false],
      ['alt-enter', press('Enter', { altKey: true }), true],
      ['alt-enter', press('Enter'), false],
    ];
    for (const [key, event, expected] of cases) {
      expect(isCommit(event, key), `${key} / ${JSON.stringify(event)}`).toBe(expected);
    }
  });

  it('修飾キーを足しすぎたものは確定にしない', () => {
    // Ctrl+Shift+Enter は「Ctrl+Enter」ではない。別の機能に割り当てる余地を残す。
    expect(isCommit(press('Enter', { ctrlKey: true, shiftKey: true }), 'ctrl-enter')).toBe(false);
  });

  it('Enter 以外は確定にならない', () => {
    for (const key of COMMIT_KEYS) {
      expect(isCommit(press('a', { ctrlKey: true }), key)).toBe(false);
    }
  });
});
