// A drawing saved as SVG: drawn with the parts it uses, the theme's drawing
// rules inside it, written where the save dialog says.

import { describe, expect, it } from 'vitest';
import { exportSvg } from '../src/export-svg.js';
import { give, held, picks, shown, Uri } from './fake-vscode.js';

const DGM = ['use "../shared/parts.dgm"', 'free {', '  ok button:"送信"', '}', 'layout {', '  ok @ (0, 0)', '}', ''].join('\n');
const PARTS = 'parts {\n  button ( ) { fill: #2f6fb5 } 120x40\n}\n';
const THEME = ':root { --font-heading: sans-serif; }\nbody { margin: 0; }\n.dp-diagram { max-width: 100%; font-family: var(--font-heading); }\n.dp-diagram .dp-label { fill: #111; }\n';

describe('SVG に書き出す', () => {
  it('図の隣に、同じ名前の .svg を既定として書く', async () => {
    give({ 'docs/login.dgm': DGM, 'shared/parts.dgm': PARTS, '/ext/media/theme.css': THEME });
    await exportSvg(Uri.file('/ext'), Uri.file('/w/docs/login.dgm'));
    const svg = held.get('docs/login.svg')!;
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('<svg class="dp-diagram"');
    expect(svg).toContain('送信');
    expect(svg).toContain('.dp-diagram .dp-label { fill: #111; }');
    expect(svg).not.toContain('body {');
    expect(shown).toEqual(['DocPresenter Diagram: docs/login.svg に書き出しました']);
  });

  it('保存をやめたら、何も書かない', async () => {
    give({ 'docs/login.dgm': DGM, 'shared/parts.dgm': PARTS, '/ext/media/theme.css': THEME });
    picks.save = null;
    await exportSvg(Uri.file('/ext'), Uri.file('/w/docs/login.dgm'));
    expect(held.has('docs/login.svg')).toBe(false);
    expect(shown).toEqual([]);
  });

  it('読めない図は、理由を言って書き出さない', async () => {
    give({ 'docs/bad.dgm': 'free {\n  a [A\n}\n', '/ext/media/theme.css': THEME });
    await exportSvg(Uri.file('/ext'), Uri.file('/w/docs/bad.dgm'));
    expect(held.has('docs/bad.svg')).toBe(false);
    expect(shown[0]).toMatch(/^DocPresenter Diagram: docs\/bad\.dgm を読めないため、書き出しませんでした: /);
  });
});
