// A drawing opened as text: the suggestions VS Code is handed, with the parts
// read from the libraries the drawing uses and the files a `use` can name.

import { describe, expect, it } from 'vitest';
import { suggest } from '../src/dgm-language.js';
import { CompletionItemKind, Position, SnippetString, documentAt, give } from './fake-vscode.js';

const REPO = {
  'docs/auth/login.dgm': [
    'use "../../shared/ui-parts.dgm"',
    '',
    'free {',
    '  idBox textbox:"x"',
    '  submit |',
    '}',
  ].join('\n'),
  // A library resting on the shipped one, overriding one part.
  'shared/ui-parts.dgm': 'use "default"\n\nparts {\n  primary ( ) { fill: #2f6fb5 } 320x38\n  stamp   [ ] { fill: #fee }\n}\n',
  // A drawing, not a library: it declares no parts.
  'docs/auth/flow.dgm': 'flow {\n  a [A]\n}\n',
};

/** Opens the file at the `|` and asks for suggestions there. */
async function at(path: string, files: Record<string, string> = REPO) {
  const marked = files[path]!;
  const lines = marked.split('\n');
  const line = lines.findIndex(one => one.includes('|'));
  give({ ...files, [path]: marked.replace('|', '') });
  return suggest(await documentAt(path) as never, new Position(line, lines[line]!.indexOf('|')) as never);
}

describe('.dgm をテキストで書くときの補完', () => {
  it('id の後ろには、使っているライブラリの部品が同梱の部品と並んで出る', async () => {
    const items = await at('docs/auth/login.dgm');
    const labels = items.map(one => one.label);
    expect(labels).toContain('stamp:');      // 作業場のライブラリだけにある部品
    expect(labels).toContain('checkbox:');   // その下敷きの同梱の部品
    const stamp = items.find(one => one.label === 'stamp:')!;
    expect(stamp.kind).toBe(CompletionItemKind.Class);
    expect((stamp.insertText as unknown as SnippetString).value).toBe('stamp:"$0"');
    // 置き換えるのはカーソルの位置まで
    expect(stamp.range!.start.character).toBe('  submit '.length);
  });

  it('書きかけで読めないファイルでも、use の行から部品を拾う', async () => {
    const items = await at('docs/auth/login.dgm', {
      ...REPO,
      'docs/auth/login.dgm': 'use "../../shared/ui-parts.dgm"\n\nfree {\n  idBox textbox:"x\n  submit |\n}',
    });
    expect(items.map(one => one.label)).toContain('stamp:');
  });

  it('use の引用符の中では、部品を宣言しているファイルだけを、この図からの相対パスで出す', async () => {
    const items = await at('docs/auth/flow.dgm', {
      ...REPO,
      'docs/auth/flow.dgm': 'use "|"\n\nflow {\n  a [A]\n}\n',
    });
    expect(items.map(one => one.label)).toEqual(['default', 'icons', '../../shared/ui-parts.dgm']);
  });

  it('次にも候補があるものは、書いたあとで一覧を開き直す', async () => {
    const items = await at('docs/auth/login.dgm', { ...REPO, 'docs/auth/login.dgm': 'free {\n  a [A]\n}\nstyle {\n  |\n}' });
    expect(items.find(one => one.label === 'a')!.command?.command).toBe('editor.action.triggerSuggest');
  });
});
