import { describe, expect, it } from 'vitest';
import { checkMessages } from '@docpresenter/base';
import { PPTX_MESSAGES } from '../src/index.js';

describe('pptx messages', () => {
  it('has every Japanese key in English, with the same placeholders', () => {
    expect(checkMessages(PPTX_MESSAGES)).toEqual([]);
  });
});
