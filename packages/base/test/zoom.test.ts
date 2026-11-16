import { describe, expect, it } from 'vitest';
import { clampZoom, MAX_ZOOM, MIN_ZOOM, stepZoom } from '../src/index.js';

describe('zoom', () => {
  it('keeps a scale inside what the buttons offer', () => {
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1.3)).toBe(1.3);
  });

  it('steps to the next step, from a scale that need not be one', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.8, 1)).toBe(0.9);
    expect(stepZoom(0.8, -1)).toBe(0.75);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });
});
