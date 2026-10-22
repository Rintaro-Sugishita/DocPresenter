// The shell in two languages: the host's own sentences, what package.json
// contributes, and the starting files a folder is set up with.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { checkMessages } from '@docpresenter/base';
import { env } from 'vscode';
import { hostLocale } from '../src/l10n.js';
import { VSCODE_MESSAGES } from '../src/messages.js';
import { planScaffold } from '@docpresenter/build';

const read = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as Record<string, string>;

describe('VS Code の言語', () => {
  afterEach(() => { env.language = 'ja'; });

  it('英語のカタログは日本語と同じキーと差し込みを持つ', () => {
    expect(checkMessages(VSCODE_MESSAGES)).toEqual([]);
  });

  it('VS Code の表示言語に従う（ja 以外は英語）', () => {
    expect(hostLocale()).toBe('ja');
    env.language = 'en-us';
    expect(hostLocale()).toBe('en');
    env.language = 'de';
    expect(hostLocale()).toBe('en');
  });

  it('package.json の %キー% は、どちらの nls にもある', () => {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const used = [...manifest.matchAll(/"%([\w.-]+)%"/g)].map(match => match[1]!);
    const en = read('package.nls.json');
    const ja = read('package.nls.ja.json');
    expect(used.length).toBeGreaterThan(5);
    for (const key of used) {
      expect(en[key], `package.nls.json: ${key}`).toBeTruthy();
      expect(ja[key], `package.nls.ja.json: ${key}`).toBeTruthy();
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  });

  it('英語の VS Code では、最初の文書も英語で用意する', () => {
    const plan = planScaffold({
      name: 'auth', title: 'Auth design', today: '2026-10-07', outDir: 'out/build', locale: 'en',
    }, { guide: '# guide\n', specs: {} }, () => undefined);
    const text = (path: string) => plan.files.find(file => file.path === path)?.text ?? '';
    expect(text('docs/auth.md')).toContain('## Overview {#sec-overview}');
    expect(text('docs/auth.md')).not.toMatch(/[぀-ヿ]/);
    expect(text('docs/auth/revision.md')).toContain('Revision history');
    expect(text('shared/glossary.table')).toContain('col:Term');
    expect(text('.gitignore')).toBe('# DocPresenter output\nout/\n*.pdf\n*.pptx\n');
  });
});
