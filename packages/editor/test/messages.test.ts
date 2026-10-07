import { describe, expect, it } from 'vitest';
import { checkMessages, describeError, localizeEdit } from '@docpresenter/base';
import { parseDocument, parseTable } from '@docpresenter/markdown';
import {
  commitKeyLabel, COMMIT_KEYS, DEFAULT_SETTINGS, EDITOR_MESSAGES, insertRow, removeSheet,
} from '../src/index.js';

describe('editor messages', () => {
  it('has every Japanese key in English, with the same placeholders', () => {
    expect(checkMessages(EDITOR_MESSAGES)).toEqual([]);
  });

  it('speaks Japanese unless told otherwise', () => {
    expect(DEFAULT_SETTINGS.locale).toBe('ja');
    expect(commitKeyLabel('ctrl-enter')).toBe('Ctrl+Enter で確定 / Enter で改行');
    for (const key of COMMIT_KEYS) expect(commitKeyLabel(key, 'en')).toMatch(/commits/);
  });

  it('names table and sheet edits by id', () => {
    const table = parseTable('| a |\n| - |\n| 1 |\n');
    const edit = insertRow(table, 0);
    expect(edit.phrase?.id).toBe('editor.did.insertRow');
    expect(localizeEdit(edit, 'en').description).toBe('Add a row');
  });

  it('refuses in either language', () => {
    let caught: unknown;
    try { removeSheet(parseDocument('# 一枚\n'), '# 一枚\n', 1); } catch (error) { caught = error; }
    expect((caught as Error).message).toBe('最後のシートは削除できない');
    expect(describeError(caught, 'en')).toBe('The last sheet cannot be deleted');
  });
});
