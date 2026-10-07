// The web shell's language choice, without a browser: a window is only the
// handful of things the choice looks at.

import { describe, expect, it } from 'vitest';
import { checkMessages } from '@docpresenter/base';
import {
  LOCALE_KEY, rememberLocale, SHELL_MESSAGES, startingLocale, storedLocale,
} from './locale.mjs';

const fakeWindow = ({ search = '', languages = ['ja-JP'], stored, broken = false } = {}) => {
  const held = new Map(stored ? [[LOCALE_KEY, stored]] : []);
  const localStorage = {
    getItem: key => held.get(key) ?? null,
    setItem: (key, value) => { held.set(key, value); },
  };
  const win = { location: { search }, navigator: { languages }, held };
  Object.defineProperty(win, 'localStorage', {
    get() { if (broken) throw new Error('SecurityError'); return localStorage; },
  });
  return win;
};

describe('Web シェルの表示言語', () => {
  it('シェルの英語の文言は日本語と同じキーと差し込みを持つ', () => {
    expect(checkMessages(SHELL_MESSAGES)).toEqual([]);
  });

  it('初回はブラウザの言語を薦めて尋ねる', () => {
    expect(startingLocale(fakeWindow({ languages: ['ja-JP', 'en'] }))).toEqual({ locale: 'ja', ask: true });
    expect(startingLocale(fakeWindow({ languages: ['en-US'] }))).toEqual({ locale: 'en', ask: true });
    expect(startingLocale(fakeWindow({ languages: ['fr-FR'] }))).toEqual({ locale: 'en', ask: true });
  });

  it('覚えた選択があれば尋ねない', () => {
    const win = fakeWindow({ languages: ['ja'] });
    rememberLocale('en', win);
    expect(storedLocale(win)).toBe('en');
    expect(startingLocale(win)).toEqual({ locale: 'en', ask: false });
  });

  it('?lang= はその回だけ決め、尋ねも覚えもしない', () => {
    const win = fakeWindow({ search: '?lang=ja', languages: ['en'] });
    expect(startingLocale(win)).toEqual({ locale: 'ja', ask: false });
    expect(win.held.size).toBe(0);
  });

  it('localStorage が使えなくても動く（毎回尋ねるだけ）', () => {
    const win = fakeWindow({ broken: true, languages: ['en'] });
    expect(() => rememberLocale('ja', win)).not.toThrow();
    expect(storedLocale(win)).toBeUndefined();
    expect(startingLocale(win)).toEqual({ locale: 'en', ask: true });
  });

  it('覚えた値が壊れていれば無いものとして扱う', () => {
    expect(startingLocale(fakeWindow({ stored: 'fr', languages: ['ja'] }))).toEqual({ locale: 'ja', ask: true });
  });
});
