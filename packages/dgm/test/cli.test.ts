// The command line's reading of what was asked: options, the files meant,
// where they are written. Run against folders made for each test.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMessages } from '@docpresenter/base';
import {
  CLI_MESSAGES, CliError, collectTargets, DGM_SPEC, drawingJobs, findRoot, isDrawing, listOf, outputFile,
  outputPlan, parseArgs, refuseCollisions, runDgm,
} from '../src/index.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dgm-cli-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

function give(files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

const FLOW = 'flow {\n  a [A]\n  b [B]\n  a --> b\n}\n';

describe('引数の読み取り', () => {
  it('--to はカンマ区切り・繰り返し・= ・短い名前のどれでも同じ', () => {
    for (const argv of [['--to', 'svg,png'], ['--to', 'svg', '--to', 'png'], ['--to=svg', '-t', 'png'], ['-tsvg', '-tpng']]) {
      expect(listOf(parseArgs(argv, DGM_SPEC), 'to')).toEqual(['svg', 'png']);
    }
  });

  it('知らないオプション・値の無いオプションは誤りとして止める', () => {
    expect(() => parseArgs(['--wirte'], DGM_SPEC)).toThrow(CliError);
    expect(() => parseArgs(['--out'], DGM_SPEC)).toThrow(CliError);
    expect(() => parseArgs(['--write=yes'], DGM_SPEC)).toThrow(CliError);
  });

  it('-- の後ろはすべてパスとして読む', () => {
    expect(parseArgs(['export', '--', '--odd.dgm'], DGM_SPEC).positionals).toEqual(['export', '--odd.dgm']);
  });
});

describe('作業場と対象', () => {
  it('ルートは .docpresenter/ のある所、無ければ .git のある所', () => {
    give({ '.git/HEAD': '', 'docs/.keep': '', 'docs/a.dgm': FLOW });
    expect(findRoot(undefined, ['docs/a.dgm'], dir)).toBe(dir);
    give({ 'docs/.docpresenter/x': '' });
    expect(findRoot(undefined, ['docs/a.dgm'], dir)).toBe(join(dir, 'docs'));
  });

  it('フォルダからは欲しいものだけ、直に指したものはそのまま拾い、out/ は辿らない', () => {
    give({ 'a.dgm': FLOW, 'sub/b.dgm': FLOW, 'sub/c.md': '# c', 'out/build/d.dgm': FLOW, 'x.txt': '' });
    const found = collectTargets(['.', 'x.txt'], dir, isDrawing, dir);
    expect(found.map(one => [one.path, one.named])).toEqual([['a.dgm', false], ['sub/b.dgm', false], ['x.txt', true]]);
  });

  it('作業場の外や、無いパスは誤り', () => {
    give({ 'a.dgm': FLOW });
    expect(() => collectTargets(['..'], dir, isDrawing, dir)).toThrow(CliError);
    expect(() => collectTargets(['nope.dgm'], dir, isDrawing, dir)).toThrow(CliError);
  });
});

describe('書き出し先', () => {
  it('既定は作業場の out/build/ で、フォルダ構成を保つ', () => {
    const plan = outputPlan(dir, undefined, false, dir);
    expect(outputFile(plan, 'docs/order/a.dgm', 'svg')).toBe(join(dir, 'out/build/docs/order/a.svg'));
    expect(outputFile(outputPlan(dir, 'pics', true, dir), 'docs/order/a.dgm', 'png')).toBe(join(dir, 'pics/a.png'));
  });

  it('--flat で名前がぶつかれば、何も書かずに止める', () => {
    give({ 'a/x.dgm': FLOW, 'b/x.dgm': FLOW });
    const plan = outputPlan(dir, undefined, true, dir);
    const jobs = drawingJobs(collectTargets([], dir, isDrawing, dir), [], plan);
    expect(() => refuseCollisions(jobs.map(job => ({ source: job.target.path, file: job.file })))).toThrow(CliError);
  });

  it('直に指した図に合わない形式は誤り、フォルダから拾った図なら飛ばす', () => {
    give({ 'a.dgm': FLOW });
    const plan = outputPlan(dir, undefined, false, dir);
    expect(() => drawingJobs(collectTargets(['a.dgm'], dir, isDrawing, dir), ['pdf'], plan)).toThrow(CliError);
    expect(drawingJobs(collectTargets(['.'], dir, isDrawing, dir), ['pdf'], plan)).toEqual([]);
  });
});

describe('dgm コマンド', () => {
  const run = async (...argv: string[]) => {
    const said: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(line => { said.push(String(line)); });
    vi.spyOn(console, 'error').mockImplementation(line => { said.push(String(line)); });
    const code = await runDgm([...argv, '--root', dir, '--lang', 'ja'], import.meta.url);
    vi.restoreAllMocks();
    return { code, said: said.join('\n') };
  };

  it('export は SVG を out/build/ に、元と同じフォルダ構成で書く', async () => {
    give({ 'docs/a.dgm': FLOW });
    const { code } = await run('export', join(dir, 'docs'));
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'out/build/docs/a.svg'), 'utf8')).toMatch(/^<\?xml[\s\S]*<svg class="dp-diagram"/);
  });

  it('check は読めない行を path:line で言い、終了コード 1', async () => {
    give({ 'a.dgm': 'flow {\n  a [A\n}\n' });
    const { code, said } = await run('check');
    expect(code).toBe(1);
    expect(said).toMatch(/^a\.dgm:\d+(:\d+)?: エラー: /m);
  });

  it('format は --write が無ければ書き換えず、--check なら終了コード 1', async () => {
    const messy = 'flow {\n  b [B]\n  a [A]\n  a-->b\n}\n';
    give({ 'a.dgm': messy });
    expect((await run('format', '--check')).code).toBe(1);
    expect(readFileSync(join(dir, 'a.dgm'), 'utf8')).toBe(messy);
    expect((await run('format', '--write')).code).toBe(0);
    expect(readFileSync(join(dir, 'a.dgm'), 'utf8')).not.toBe(messy);
    expect((await run('format', '--check')).code).toBe(0);
  });

  it('図でないファイルを指すと、使い方の誤り（終了コード 2）', async () => {
    give({ 'a.md': '# a' });
    const { code, said } = await run('export', join(dir, 'a.md'));
    expect(code).toBe(2);
    expect(said).toContain('a.md は図（.dgm）ではありません');
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });

  it('知らないコマンドは終了コード 2', async () => {
    expect((await run('draw')).code).toBe(2);
  });
});

describe('文言', () => {
  it('日本語と英語が揃っている', () => {
    expect(checkMessages(CLI_MESSAGES)).toEqual([]);
  });
});
