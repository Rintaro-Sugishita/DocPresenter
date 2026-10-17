// Formatting a drawing from VS Code: "Format Document" and the command give the
// formatter's text, read through the libraries the drawing uses.

import { describe, expect, it } from 'vitest';
import { formatDiagram } from '@docpresenter/diagram';
import { formatDiagramFile, formatEdits, registerDgmFormatter } from '../src/format-command.js';
import { documentAt, formatters, give, held, saved, shown, Uri } from './fake-vscode.js';

const TYPED = [
  'use "../shared/parts.dgm"',
  'free {',
  '  ok   button:"送信"',
  '  title "ログイン"',
  '}',
  'layout {',
  '  ok @ (0,80)',
  '  title @ (0, 0)',
  '}',
  '',
].join('\n');
const PARTS = 'parts {\n  button ( ) { fill: #2f6fb5 } 120x40\n}\n';

describe('図を整形する', () => {
  it('"Format Document" replaces only the lines that change', async () => {
    give({ 'docs/login.dgm': TYPED, 'shared/parts.dgm': PARTS });
    registerDgmFormatter();
    const provider = formatters[formatters.length - 1]!;
    expect(provider.selector).toEqual({ language: 'dgm' });

    const document = await documentAt('docs/login.dgm');
    const edits = await provider.provider.provideDocumentFormattingEdits(document);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.range.start.line).toBeGreaterThan(0);
    document.replace(edits[0]!.range, edits[0]!.newText);
    expect(document.getText()).toBe(formatDiagram(TYPED, path => (path === '../shared/parts.dgm' ? PARTS : undefined)).text);
  });

  it('the command formats the drawing and saves it', async () => {
    give({ 'docs/login.dgm': TYPED, 'shared/parts.dgm': PARTS });
    await formatDiagramFile(Uri.file('/w/docs/login.dgm'));
    expect(held.get('docs/login.dgm')).toContain('  title "ログイン"\n  ok    button:"送信"\n');
    expect(saved).toEqual(['docs/login.dgm']);
    expect(shown).toEqual(['DocPresenter Diagram: docs/login.dgm を整形しました']);
  });

  it('says so when there is nothing to change', async () => {
    give({ 'docs/a.dgm': 'free {\n  a [A]\n}\n\nlayout {\n  a @ (0, 0)\n}\n' });
    await formatDiagramFile(Uri.file('/w/docs/a.dgm'));
    expect(saved).toEqual([]);
    expect(shown).toEqual(['DocPresenter Diagram: docs/a.dgm はすでに整形されています']);
  });

  it('says why a drawing that cannot be read is left alone', async () => {
    give({ 'docs/a.dgm': 'free {\n  a [A\n}\n' });
    const edits = await formatEdits(await documentAt('docs/a.dgm'));
    expect(edits).toBeUndefined();
    expect(shown[0]).toMatch(/^DocPresenter Diagram: docs\/a\.dgm を読めないため、整形しませんでした: /);
  });

  it('refuses anything but a drawing', async () => {
    give({ 'docs/a.md': '# A\n' });
    await formatDiagramFile(Uri.file('/w/docs/a.md'));
    expect(shown).toEqual(['DocPresenter Diagram: 図（.dgm）を開いてから実行してください']);
  });
});
