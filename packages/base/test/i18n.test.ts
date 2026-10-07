import { describe, expect, it } from 'vitest';
import {
  BASE_MESSAGES, checkMessages, defineMessages, describeError, described, localizeEdit,
  LocalizedError, pickLocale, say,
} from '../src/index.js';

describe('messages', () => {
  it('has every Japanese key in English, with the same placeholders', () => {
    expect(checkMessages(BASE_MESSAGES)).toEqual([]);
  });

  it('fills placeholders, phrases inside phrases included', () => {
    const t = BASE_MESSAGES.in('en');
    expect(t('base.swatch.named', { label: 'Fill', name: 'red' })).toBe('Fill: red');
    const inner = BASE_MESSAGES.phrase('base.format.code');
    expect(say('en', BASE_MESSAGES.phrase('base.atLine', { message: inner, line: 3 }))).toBe('Code (line 3)');
    expect(say('ja', BASE_MESSAGES.phrase('base.atLine', { message: inner, line: 3 }))).toBe('コード（3 行目）');
  });

  it('finds what a check of the catalogues is for', () => {
    const broken = defineMessages(
      { 'test.a': '{n} 行', 'test.b': '' },
      { 'test.a': '{count} rows', 'test.b': 'b' },
    );
    expect(checkMessages(broken)).toEqual([
      'test.a has {n} in ja but {count} in en',
      'ja test.b is empty',
    ]);
  });

  it('keeps Japanese as what an error and an edit say by default', () => {
    const phrase = BASE_MESSAGES.phrase('base.cancel');
    const error = new LocalizedError(phrase);
    expect(error.message).toBe('やめる');
    expect(describeError(error, 'en')).toBe('Cancel');
    expect(describeError(new Error('plain'), 'en')).toBe('plain');
    const edit = { span: { start: 0, end: 0 }, text: '', ...described(phrase) };
    expect(edit.description).toBe('やめる');
    expect(localizeEdit(edit, 'en').description).toBe('Cancel');
  });
});

describe('pickLocale', () => {
  it('takes the first tag in a language it has, and English otherwise', () => {
    expect(pickLocale(['ja'])).toBe('ja');
    expect(pickLocale(['ja-JP', 'en'])).toBe('ja');
    expect(pickLocale(['en-US', 'ja'])).toBe('en');
    expect(pickLocale(['fr', 'ja'])).toBe('ja');
    expect(pickLocale(['fr', 'de'])).toBe('en');
    expect(pickLocale([])).toBe('en');
  });
});
