import { describe, expect, it } from 'vitest';
import { importLinks, importTarget, pathKind, registerImportLinks } from '../src/import-links.js';
import { give, linkers, Uri } from './fake-vscode.js';

const DOC = [
  '# 設計',
  '',
  '@import "auth/login.dgm" {#fig-login caption="ログイン"}',
  '@import "../shared/glossary.table"',
  '@import "/shared/system.dgm"',
  '@import "C:\\design\\other.dgm"',
  '',
  '```markdown',
  '@import "in-code.dgm"',
  '```',
  '',
].join('\n');

describe('@import をリンクにする', () => {
  it('行頭の @import の引用符の中だけを拾い、コードの中は拾わない', () => {
    const links = importLinks(DOC);
    expect(links.map(one => one.path)).toEqual([
      'auth/login.dgm', '../shared/glossary.table', '/shared/system.dgm', 'C:\\design\\other.dgm',
    ]);
    const first = links[0]!;
    expect(DOC.slice(first.start, first.end)).toBe('auth/login.dgm');
  });

  it('書き方で、どこを探すかが決まる', () => {
    expect(pathKind('a/b.dgm')).toBe('relative');
    expect(pathKind('../b.dgm')).toBe('relative');
    expect(pathKind('/shared/b.dgm')).toBe('workspace');
    expect(pathKind('C:\\x\\b.dgm')).toBe('machine');
    expect(pathKind('D:/x/b.dgm')).toBe('machine');
    expect(pathKind('https://example.com/a.png')).toBe('address');
  });

  it('相対は文書から、/ 始まりはワークスペースの最上位から、無ければこの機械の絶対パス', async () => {
    give({ 'shared/system.dgm': 'free {\n}\n' });
    const doc = Uri.file('/w/docs/design.md') as never;
    expect((await importTarget(doc, '../shared/glossary.table'))?.fsPath).toBe('/w/shared/glossary.table');
    expect((await importTarget(doc, 'auth/login.dgm'))?.fsPath).toBe('/w/docs/auth/login.dgm');
    expect((await importTarget(doc, '/shared/system.dgm'))?.fsPath).toBe('/w/shared/system.dgm');
    expect((await importTarget(doc, '/opt/elsewhere.dgm'))?.fsPath).toBe('/opt/elsewhere.dgm');
    expect((await importTarget(doc, 'C:\\design\\other.dgm'))?.fsPath).toBe('C:\\design\\other.dgm');
  });

  it('VS Code のリンクとして、引用符の中の範囲で出す（CRLF でも）', async () => {
    give({});
    registerImportLinks();
    const provider = linkers.at(-1)!.provider;
    const text = DOC.replace(/\n/g, '\r\n');
    const links = await provider.provideDocumentLinks({ uri: Uri.file('/w/docs/design.md'), getText: () => text });
    expect(links).toHaveLength(4);
    expect(links[0]!.range.start).toMatchObject({ line: 2, character: 9 });
    expect(links[0]!.range.end).toMatchObject({ line: 2, character: 9 + 'auth/login.dgm'.length });
    expect(links[1]!.target?.fsPath).toBe('/w/shared/glossary.table');
  });
});
