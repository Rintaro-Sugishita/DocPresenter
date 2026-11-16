import { describe, expect, it } from 'vitest';
import { byteLength } from '@docpresenter/base';
import { nodeAtSpan, nodeSpan } from '../src/index.js';

const SOURCE = [
  'flow {',
  '  login [ログイン画面]',
  '  auth  (認証 API)',
  '  login --> auth',
  '}',
  '',
].join('\n');

const at = (text: string): { start: number; end: number } => {
  const index = SOURCE.indexOf(text);
  const start = byteLength(SOURCE.slice(0, index));
  return { start, end: start + byteLength(text) };
};

describe('node anchors', () => {
  it('finds the shape a range of its line is about', () => {
    const { start, end } = at('認証 API');
    expect(nodeAtSpan(SOURCE, start, end)).toBe('auth');
    const span = nodeSpan(SOURCE, 'login')!;
    expect(nodeAtSpan(SOURCE, span.start, span.end)).toBe('login');
  });

  it('gives the line that declares the shape', () => {
    const span = nodeSpan(SOURCE, 'auth')!;
    expect(span).toBeDefined();
    const line = new TextDecoder().decode(new TextEncoder().encode(SOURCE).slice(span.start, span.end));
    expect(line).toContain('認証 API');
  });

  it('is about no shape on a connection, or for one that is not there', () => {
    const { start, end } = at('login --> auth');
    expect(nodeAtSpan(SOURCE, start, end)).toBeUndefined();
    expect(nodeSpan(SOURCE, 'nobody')).toBeUndefined();
  });
});
