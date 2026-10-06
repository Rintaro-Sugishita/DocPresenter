import { describe, expect, it } from 'vitest';
import { sliceBytes } from '@docpresenter/base';
import {
  fenceInfo, fencesOf, parseDocument, renderDocument, resolveDocument, setFenceView,
} from '../src/index.js';

const NL = '\n';
const render = (source: string, files: Record<string, string> = {}): string => {
  const doc = parseDocument(source);
  return renderDocument(doc, resolveDocument(doc), { loader: { read: path => files[path] } });
};

describe('コードブロックの中は本文として読む', () => {
  it('# の行は見出しにならない', () => {
    const doc = parseDocument(['# 題', '', '```bash', '# コメント', 'ls', '```'].join(NL));
    expect(doc.blocks.map(block => block.kind)).toEqual(['heading', 'prose']);
  });

  it('--- はシートの区切りにならない', () => {
    const doc = parseDocument(['前', '', '```yaml', '---', 'a: 1', '```', '', '後'].join(NL));
    expect(doc.blocks.map(block => block.kind)).toEqual(['prose']);
  });

  it('@import の行は取り込みにならない', () => {
    const doc = parseDocument(['```', '@import "x.dgm"', '```'].join(NL));
    expect(doc.blocks.map(block => block.kind)).toEqual(['prose']);
  });

  it('閉じたあとは元どおり', () => {
    const doc = parseDocument(['```', 'code', '```', '', '# 見出し'].join(NL));
    expect(doc.blocks.map(block => block.kind)).toEqual(['prose', 'heading']);
  });

  it('@参照はコードの中では置き換えない', () => {
    const html = render(['@import "a.dgm" {#fig-a}', '', '```', '@fig-a', '```'].join(NL),
      { 'a.dgm': 'free {\n a [A]\n}\nlayout {\n a @ (0,0)\n}' });
    expect(html).toContain('@fig-a');
  });
});

describe('色付け', () => {
  it('言語名があれば hljs のクラスで色を付ける', () => {
    const html = render(['```typescript', 'const a = 1;', '```'].join(NL));
    expect(html).toContain('<code class="hljs language-typescript">');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  it('言語名を読み手の知る名前で添える', () => {
    expect(render(['```ts', 'let a', '```'].join(NL)))
      .toContain('<span class="dp-code-language">TypeScript</span>');
    expect(render(['```sql', 'select 1', '```'].join(NL)))
      .toContain('<span class="dp-code-language">SQL</span>');
    // 知らない言語は書いたまま、言語なしはラベルを付けない
    expect(render(['```cobol', 'MOVE A TO B', '```'].join(NL)))
      .toContain('<span class="dp-code-language">cobol</span>');
    expect(render(['```', 'x', '```'].join(NL))).not.toContain('dp-code-language');
  });

  // packages/app-vscode/README.md「色が付く言語」の表と同じ一覧。表を変えたらここも変える。
  it('文書に載せた言語名は、どれも色が付く', () => {
    const names = [
      'bash', 'sh', 'zsh', 'shell', 'console', 'powershell', 'ps', 'ps1',
      'javascript', 'js', 'jsx', 'mjs', 'cjs', 'typescript', 'ts', 'tsx', 'mts', 'cts',
      'json', 'yaml', 'yml', 'xml', 'html', 'xhtml', 'svg', 'css', 'sql', 'python', 'py',
      'java', 'kotlin', 'kt', 'csharp', 'cs', 'c#', 'go', 'golang', 'diff', 'patch',
      'ini', 'toml', 'dockerfile', 'docker', 'markdown', 'md', 'plaintext', 'text', 'txt',
    ];
    const plain = names.filter(name => !render(['```' + name, 'x', '```'].join(NL)).includes('class="hljs '));
    expect(plain).toEqual([]);
  });

  it('知らない言語・言語なしは書いたまま', () => {
    expect(render(['```cobol', 'MOVE A TO B', '```'].join(NL))).not.toContain('hljs');
    expect(render(['```', 'x < y', '```'].join(NL))).toContain('x &lt; y');
  });
});

describe('Mermaid', () => {
  const SOURCE = ['前置き', '', '```mermaid {view="both"}', 'flowchart TD', '  A --> B', '```'].join(NL);

  it('図とコードの両方を持ち、見せ方は属性で決まる', () => {
    const html = render(SOURCE);
    expect(html).toContain('class="dp-mermaid" data-view="both"');
    expect(html).toContain('class="dp-mermaid-diagram" data-source="flowchart TD');
    expect(html).toContain('class="dp-code dp-mermaid-code"');
  });

  it('既定は図', () => {
    expect(render(['```mermaid', 'flowchart TD', '```'].join(NL))).toContain('data-view="diagram"');
  });

  it('範囲は開きの行を指す（切り替えはその行を書き換える）', () => {
    const html = render(SOURCE);
    const [start, end] = /class="dp-mermaid" data-view="both" data-span="(\d+),(\d+)"/.exec(html)!
      .slice(1).map(Number);
    expect(sliceBytes(SOURCE, start!, end!)).toBe('```mermaid {view="both"}');
  });

  it('.mmd を取り込むと、@import の view に従う', () => {
    const html = render('@import "seq.mmd" {view="code"}', { 'seq.mmd': 'sequenceDiagram\n A ->> B: hi\n' });
    expect(html).toContain('data-view="code"');
    expect(html).not.toContain('dp-unrendered');
  });

  it('開きの行の view を書き換える（ほかの属性は残す）', () => {
    expect(setFenceView('```mermaid', 'code')).toBe('```mermaid {view="code"}');
    expect(setFenceView('```mermaid {view="code"}', 'diagram')).toBe('```mermaid');
    expect(setFenceView('~~~ mermaid {id="a" view="both"}', 'code')).toBe('~~~ mermaid {id="a" view="code"}');
    expect(setFenceView('```js', 'code')).toBe('```js');
  });

  it('開きの行を読む', () => {
    const info = fenceInfo('mermaid {view="code"}');
    expect(info.language).toBe('mermaid');
    expect(info.attributes.get('view')).toBe('code');
  });

  it('本文からコードブロックを拾う', () => {
    const found = fencesOf(SOURCE);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ language: 'mermaid', content: 'flowchart TD\n  A --> B', from: 2, to: 5 });
  });
});
