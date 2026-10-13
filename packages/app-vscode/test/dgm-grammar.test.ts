// The colours of a .dgm opened as text, read with the tokenizer VS Code itself
// uses (vscode-textmate over Oniguruma), so a grammar that only looked right
// in a JSON file is caught here.

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { INITIAL, Registry, parseRawGrammar, type IGrammar, type StateStack } from 'vscode-textmate';
import { OnigScanner, OnigString, loadWASM } from 'vscode-oniguruma';

const GRAMMAR = 'packages/app-vscode/syntaxes/dgm.tmLanguage.json';
let grammar: IGrammar;

beforeAll(async () => {
  const wasm = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: sources => new OnigScanner(sources),
      createOnigString: text => new OnigString(text),
    }),
    loadGrammar: async () => parseRawGrammar(readFileSync(GRAMMAR, 'utf8'), GRAMMAR),
  });
  grammar = (await registry.loadGrammar('source.dgm'))!;
});

/** Each line's pieces, with the innermost scope of each (sections left out). */
function tokens(source: string): [string, string][][] {
  let state: StateStack = INITIAL;
  return source.split(/\r?\n/).map(line => {
    const found = grammar.tokenizeLine(line, state);
    state = found.ruleStack;
    return found.tokens
      .map(({ startIndex, endIndex, scopes }): [string, string] =>
        [line.slice(startIndex, endIndex), scopes.filter(one => !one.startsWith('meta.')).slice(1).join(' ')])
      .filter(([text]) => text.trim() !== '');
  });
}

/** The scope a piece of a line was given. */
function scopeOf(source: string, line: number, text: string): string {
  return tokens(source)[line]!.find(([piece]) => piece === text)?.[1] ?? '(none)';
}

function dgmFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? dgmFiles(join(folder, entry.name))
      : entry.name.endsWith('.dgm') ? [join(folder, entry.name)] : []);
}

describe('.dgm の色付け', () => {
  it('標本の図はどの行も読める（誤りの色も、色の無い語も出ない）', () => {
    const files = dgmFiles('sample');
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      tokens(readFileSync(file, 'utf8')).forEach((line, index) => {
        for (const [text, scope] of line) {
          const where = `${file}:${index + 1} ${JSON.stringify(text)}`;
          expect(scope, where).not.toContain('invalid');
          // 句読点だけのかけらは色が無くてよい
          if (/[^\s;,]/.test(text)) expect(scope, where).not.toBe('');
        }
      });
    }
  });

  it('層ごとに同じ形の行を読み分ける', () => {
    const file = [
      'flow Login {',                          // 0
      '  start ([Start]) :::changed',          // 1
      '  db    [(Users DB)]',                  // 2
      '  start -.-> db "reads **this**"',      // 3
      '  rule1 --',                            // 4
      '  group back "Back end" { db }',        // 5
      '  nav tree: {',                         // 6
      '    - Top *',                           // 7
      '  }',                                   // 8
      '}',                                     // 9
      'layout {',                              // 10
      '  start @ (40, -20) 140x60 z:-1',       // 11
      '  start -> db @ (600, 120); (600, 240)', // 12
      '  grid form (cols: 120, 1fr; gap: 8 12) {', // 13
      '    start; db',                         // 14
      '  }',                                   // 15
      '}',                                     // 16
      'style {',                               // 17
      '  theme: default',                      // 18
      '  db { fill: #e3f2fd, line: dashed, icon: net/router }', // 19
      '}',                                     // 20
      'oops',                                  // 21
    ].join('\n');
    expect(scopeOf(file, 0, 'flow')).toBe('keyword.control.section.dgm');
    expect(scopeOf(file, 1, 'start')).toBe('entity.name.tag.dgm');
    expect(scopeOf(file, 1, '([')).toBe('keyword.operator.shape.dgm');
    expect(scopeOf(file, 1, 'Start')).toBe('string.unquoted.label.dgm');
    expect(scopeOf(file, 1, 'changed')).toBe('entity.other.attribute-name.class.dgm');
    expect(scopeOf(file, 2, ')]')).toBe('keyword.operator.shape.dgm');
    expect(scopeOf(file, 3, 'start')).toBe('variable.other.dgm');
    expect(scopeOf(file, 3, '-.->')).toBe('keyword.operator.connector.dgm');
    expect(scopeOf(file, 3, 'this')).toBe('string.quoted.double.label.dgm markup.bold.dgm');
    expect(scopeOf(file, 4, '--')).toBe('keyword.operator.shape.dgm');
    expect(scopeOf(file, 5, 'group')).toBe('keyword.other.group.dgm');
    expect(scopeOf(file, 6, 'tree')).toBe('support.class.part.dgm');
    expect(scopeOf(file, 7, 'Top')).toBe('string.unquoted.label.dgm');
    // 一覧を閉じる } で flow は閉じない
    expect(scopeOf(file, 9, '}')).toBe('punctuation.section.block.end.dgm');
    expect(scopeOf(file, 11, 'start')).toBe('variable.other.dgm');
    expect(scopeOf(file, 11, '-20')).toBe('constant.numeric.dgm');
    expect(scopeOf(file, 11, '140')).toBe('constant.numeric.width.dgm');
    // layout の a -> b は接続ではなく折れ点
    expect(scopeOf(file, 12, '@')).toBe('keyword.operator.at.dgm');
    expect(scopeOf(file, 13, 'cols')).toBe('support.type.property-name.dgm');
    expect(scopeOf(file, 14, 'db')).toBe('variable.other.dgm');
    expect(scopeOf(file, 18, 'default')).toBe('support.constant.theme.dgm');
    expect(scopeOf(file, 19, '#e3f2fd')).toBe('constant.other.color.rgb-value.dgm');
    expect(scopeOf(file, 19, 'dashed')).toBe('support.constant.dgm');
    // 最上位の読めない行は誤り（spec §1）
    expect(scopeOf(file, 21, 'oops')).toBe('invalid.illegal.unrecognized.dgm');
  });

  it('拡張機能の宣言が文法と言語設定を指している', () => {
    const manifest = JSON.parse(readFileSync('packages/app-vscode/package.json', 'utf8'));
    const [language] = manifest.contributes.languages;
    const [grammarEntry] = manifest.contributes.grammars;
    expect(language.extensions).toEqual(['.dgm']);
    expect(grammarEntry.language).toBe(language.id);
    for (const path of [language.configuration, grammarEntry.path]) {
      expect(() => JSON.parse(readFileSync(join('packages/app-vscode', path), 'utf8'))).not.toThrow();
    }
  });
});
