// The diagram extension in two languages: its own sentences and what its
// package.json contributes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkMessages } from '@docpresenter/base';
import { DIAGRAM_EXTENSION_MESSAGES } from '../src/messages.js';

const read = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as Record<string, string>;

describe('DocPresenter Diagram の言語', () => {
  it('英語のカタログは日本語と同じキーと差し込みを持つ', () => {
    expect(checkMessages(DIAGRAM_EXTENSION_MESSAGES)).toEqual([]);
  });

  it('package.json の %キー% は、どちらの nls にもある', () => {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const used = [...manifest.matchAll(/"%([\w.-]+)%"/g)].map(match => match[1]!);
    const en = read('package.nls.json');
    const ja = read('package.nls.ja.json');
    for (const key of used) {
      expect(en[key], `package.nls.json: ${key}`).toBeTruthy();
      expect(ja[key], `package.nls.ja.json: ${key}`).toBeTruthy();
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  });

  it('文書の拡張は、作図の拡張をパックで連れてくる', () => {
    const main = JSON.parse(readFileSync(new URL('../../app-vscode/package.json', import.meta.url), 'utf8'));
    const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(main.extensionPack).toEqual([`${own.publisher}.${own.name}`]);
    // .dgm の言語を名乗るのは作図の拡張だけ。
    expect(main.contributes.languages).toBeUndefined();
    expect(own.contributes.languages[0].extensions).toEqual(['.dgm']);
  });
});
