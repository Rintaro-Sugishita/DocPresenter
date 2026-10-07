import { describe, expect, it } from 'vitest';
import { checkMessages } from '@docpresenter/base';
import { PDF_MESSAGES } from '../src/index.js';

describe('pdf messages', () => {
  it('has every Japanese key in English, with the same placeholders', () => {
    expect(checkMessages(PDF_MESSAGES)).toEqual([]);
  });
});
