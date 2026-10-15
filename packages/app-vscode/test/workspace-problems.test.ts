// The folder's problems: what goes in the Problems panel for the documents,
// and on which line of which file.

import { describe, expect, it } from 'vitest';
import { checkProblems } from '../src/workspace-problems.js';
import { DiagnosticSeverity, type Diagnostic } from './fake-vscode.js';

function problems(files: Record<string, string>): Map<string, Diagnostic[]> {
  return checkProblems({
    list: () => Object.keys(files),
    read: path => files[path],
    dataUrl: () => undefined,
  }, 'ja') as unknown as Map<string, Diagnostic[]>;
}

const doc = (head: string, body = '# 題\n\n本文\n'): string => `---\n${head}\noutput: [html]\n---\n\n${body}`;

describe('文書の問題を「問題」パネルに出す', () => {
  it('文書番号の重複は、両方の文書の document: の行に出る', () => {
    const found = problems({
      'docs/a.md': doc('document: SD-001'),
      'docs/b.md': doc('title: B\ndocument: SD-001'),
    });
    expect(found.get('docs/a.md')!.map(one => one.range.start.line)).toEqual([1]);
    expect(found.get('docs/b.md')!.map(one => one.range.start.line)).toEqual([2]);
    expect(found.get('docs/a.md')![0]!.message).toContain('docs/b.md');
  });

  it('ビルドする文書に文書番号が無ければ、先頭の行に出る', () => {
    const found = problems({ 'docs/a.md': doc('title: A') });
    expect(found.get('docs/a.md')!.map(one => [one.range.start.line, one.message.includes('document:')]))
      .toEqual([[0, true]]);
  });

  it('取り込み先のファイルが無ければ、その @import の行にエラーとして出る', () => {
    const found = problems({ 'docs/a.md': doc('document: SD-001', '# 題\n\n@import "missing.dgm"\n') });
    const [missing] = found.get('docs/a.md')!;
    expect(missing!.severity).toBe(DiagnosticSeverity.Error);
    expect(missing!.range.start).toEqual({ line: 7, character: 0 });
  });

  it('文書番号で指した文書が無ければ、その参照に出る', () => {
    const found = problems({
      'docs/a.md': doc('document: SD-001', '# 題\n\n認証は @SD-002:fig-login と @SD-001:fig-x を見る\n'),
    });
    const [unknown] = found.get('docs/a.md')!;
    expect(found.get('docs/a.md')).toHaveLength(1);
    expect(unknown!.message).toContain('SD-002');
    // 日本語の後ろでも、桁は UTF-16 で数える
    expect(unknown!.range.start).toEqual({ line: 7, character: '認証は '.length });
    expect(unknown!.range.end.character).toBe('認証は @SD-002:fig-login'.length);
  });

  it('CRLF のファイルでも同じ行に出る', () => {
    const found = problems({
      'docs/a.md': doc('document: SD-001', '# 題\n\n@import "missing.dgm"\n').replace(/\n/g, '\r\n'),
    });
    expect(found.get('docs/a.md')![0]!.range.start.line).toBe(7);
  });

  it('問題の無い文書には何も出ない。どの成果物にも入らないファイルも、書きかけとして黙る', () => {
    expect(problems({
      'docs/a.md': doc('document: SD-001', '# 題\n\n@import "part.md"\n'),
      'docs/part.md': '## 部品\n',
      'docs/draft.md': '# 書きかけ\n',
    })).toEqual(new Map());
  });
});

describe('図と表の問題も同じ一覧に出す', () => {
  it('自由配置に書いた向きは、見出しの行に警告として出る', () => {
    const [one] = problems({ 'a.dgm': 'free LR {\n  a [A]\n}\n\nlayout {\n  a @ (0, 0)\n}\n' }).get('a.dgm')!;
    expect(one!.severity).toBe(DiagnosticSeverity.Warning);
    expect(one!.message).toContain('flow');
    expect(one!.range.start.line).toBe(0);
  });

  it('名前の無い接続先は、その接続の行に出る', () => {
    const found = problems({ 'a.dgm': 'flow {\n  a [あ]\n  a --> zz\n}\n' }).get('a.dgm')!;
    const missing = found.find(one => one.message.includes('zz'))!;
    expect(missing.range.start).toEqual({ line: 2, character: 2 });
    expect(missing.range.end.character).toBe('  a --> zz'.length);
  });

  it('読めない行は、その行にエラーとして出る（「N 行目」は重ねない）', () => {
    const found = problems({ 'a.dgm': 'flow {\n  a [A]\n  a ?? b\n}\n', 'b.table': 'これは表ではない\n' });
    for (const [path, line] of [['a.dgm', 2], ['b.table', 0]] as const) {
      const [one] = found.get(path)!;
      expect(one!.severity).toBe(DiagnosticSeverity.Error);
      expect(one!.range.start.line).toBe(line);
      expect(one!.message).not.toMatch(/行目/);
    }
  });

  it('自由配置でまだ置いていない図形は、警告ではなくお知らせ', () => {
    const found = problems({ 'a.dgm': 'free {\n  a [A]\n}\n' }).get('a.dgm')!;
    expect(found.map(one => [one.severity, one.range.start.line])).toEqual([[DiagnosticSeverity.Information, 1]]);
  });

  it('使っているライブラリを読んでから確かめる', () => {
    expect(problems({
      'docs/a.dgm': 'use "parts.dgm"\n\nfree {\n  a stamp:"x"\n}\n\nlayout {\n  a @ (0, 0)\n}\n',
      'docs/parts.dgm': 'parts {\n  stamp [ ] 100x40\n}\n',
    })).toEqual(new Map());
  });

  it('取り込んだ文書の中の誤りは、取り込んだ側ではなくその文書に出る', () => {
    const found = problems({
      'docs/a.md': doc('document: SD-001', '# 題\n\n@import "part.md"\n'),
      'docs/part.md': '## 部品\n\n@fig-nothing を見る\n',
    });
    expect(found.has('docs/a.md')).toBe(false);
    expect(found.get('docs/part.md')![0]!.range.start).toEqual({ line: 2, character: 0 });
  });
});
