// Formatting a .dgm: one text for one drawing, and never a different drawing.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatDiagram, layOutDiagram, parseDiagram, withParts, type PartReader } from '../src/index.js';

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../sample');

function drawings(folder: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) out.push(...drawings(path));
    else if (name.endsWith('.dgm')) out.push(path);
  }
  return out;
}

function readerFor(path: string): PartReader {
  return used => {
    try {
      return readFileSync(resolve(dirname(path), used), 'utf8');
    } catch {
      return undefined;
    }
  };
}

/** Where every box is and which way every line runs, as a reader sees them. */
function picture(source: string, read: PartReader): string {
  const file = parseDiagram(source);
  if (file.mode !== 'free' && file.mode !== 'flow') return '';
  const laid = layOutDiagram(withParts(file, read));
  return JSON.stringify({
    boxes: [...laid.boxes].map(([id, b]) => `${id}:${b.x},${b.y},${b.width},${b.height}`).sort(),
    routes: laid.routes.map(r => `${r.edge.from}->${r.edge.to}:${JSON.stringify(r.points)}`).sort(),
  });
}

const lines = (...text: string[]): string => `${text.join('\n')}\n`;

describe('formatDiagram', () => {
  it('writes a hand-typed drawing in the canonical form', () => {
    const typed = lines(
      '# 構成図',
      'style {',
      '  api {color:#0d47a1;fill:#e3f2fd}',
      '  theme:default',
      '}',
      'layout {',
      'web@(240,120) 140x60',
      '  db @ (680,60) 140x60',
      '  api @ (460, 120) 140x60',
      '  browser @ (40,120) 140x60',
      '  back @ (440, 20) 400x240 z:-1',
      '}',
      'free 構成 {',
      '  db[(会員 DB)]',
      '  api [ /a/ ]',
      '  # 利用者の端末',
      '     browser  [利用者]',
      'web[Web]',
      '  api->db',
      '  web --> api "gRPC"',
      '  browser -> web "HTTPS"',
      '  group back "社内" {db;api}',
      '}',
    );
    expect(formatDiagram(typed).text).toBe(lines(
      '# 構成図',
      '',
      'free 構成 {',
      '  # 利用者の端末',
      '  browser [利用者]',
      '  web     [Web]',
      '  api     [ /a/ ]',
      '  db      [(会員 DB)]',
      '',
      '  group back "社内" { api; db }',
      '',
      '  browser --> web "HTTPS"',
      '  web     --> api "gRPC"',
      '  api     --> db',
      '}',
      '',
      'layout {',
      '  browser @ ( 40, 120)  140x60',
      '  web     @ (240, 120)  140x60',
      '  back    @ (440,  20) 400x240  z:-1',
      '  api     @ (460, 120)  140x60',
      '  db      @ (680,  60)  140x60',
      '}',
      '',
      'style {',
      '  theme: default',
      '',
      '  api { fill: #e3f2fd, color: #0d47a1 }',
      '}',
    ));
  });

  it('gives two authors of the same drawing the same file', () => {
    const one = lines(
      'flow {',
      '  ship    ([出荷])',
      '  start   ([注文受付])',
      '  check   {在庫あり？}',
      '  check -> ship "あり"',
      '  start --> check',
      '}',
      'style { ',
      '  check { line: dashed }',
      '}',
    );
    const other = lines(
      'style {',
      '  check {line:dashed}',
      '}',
      '',
      'flow {',
      '  start([注文受付])',
      '  start --> check',
      '  check{在庫あり？}',
      '  check --> ship    "あり"',
      '  ship([出荷])',
      '}',
    );
    expect(formatDiagram(one).text).toBe(formatDiagram(other).text);
    expect(formatDiagram(one).text).toBe(lines(
      'flow {',
      '  start ([注文受付])',
      '  check {在庫あり？}',
      '  ship  ([出荷])',
      '',
      '  start --> check',
      '  check --> ship "あり"',
      '}',
      '',
      'style {',
      '  check { line: dashed }',
      '}',
    ));
  });

  it('keeps a comment with the line it was written above', () => {
    const typed = lines(
      'free {',
      '  b [B]',
      '  # A の説明',
      '  a [A]',
      '}',
      'layout {',
      '  b @ (200, 0)',
      '  a @ (0, 0)',
      '}',
    );
    expect(formatDiagram(typed).text).toBe(lines(
      'free {',
      '  # A の説明',
      '  a [A]',
      '  b [B]',
      '}',
      '',
      'layout {',
      '  a @ (  0, 0)',
      '  b @ (200, 0)',
      '}',
    ));
  });

  it('keeps the shape in front in front', () => {
    // `small` is nearer the top, so reading order would write it first and
    // paint it behind `big`.
    const typed = lines(
      'free {',
      '  big   [Big]',
      '  small [Small]',
      '}',
      'layout {',
      '  big   @ ( 0, 40) 200x200',
      '  small @ (10, 10)   50x50',
      '}',
    );
    const formatted = formatDiagram(typed);
    expect(formatted.notes).toEqual([]);
    const order = layOutDiagram(parseDiagram(formatted.text)).order;
    expect(order.indexOf('big')).toBeLessThan(order.indexOf('small'));
  });

  it('reads a drawing by the page when following the arrows would move a shape', () => {
    // Nothing is pinned, so each shape is parked where its turn puts it: `a`
    // first would swap the two, so the page decides instead of the arrow.
    const typed = lines('free {', '  b [B]', '  a [A]', '  a --> b', '}');
    const formatted = formatDiagram(typed);
    expect(formatted.notes).toEqual([]);
    expect(formatted.text).toBe(lines('free {', '  b [B]', '  a [A]', '', '  a --> b', '}'));
    expect(picture(formatted.text, () => undefined)).toBe(picture(typed, () => undefined));
  });

  it('keeps the written order when no reading order keeps the picture', () => {
    // The container has no place, so all three are parked in the order written,
    // and every reading order puts the container before what it holds.
    const typed = lines('free {', '  a [A]', '  f [F]', '  b [B]', '}', 'layout {', '  stack f { a ; b }', '}');
    const formatted = formatDiagram(typed);
    expect(formatted.notes.map(note => note.id)).toEqual(['diagram.format.keptOrder']);
    expect(formatted.text.indexOf('a [A]')).toBeLessThan(formatted.text.indexOf('f [F]'));
    expect(picture(formatted.text, () => undefined)).toBe(picture(typed, () => undefined));
  });

  it('writes container settings only where they differ from the default', () => {
    const typed = lines(
      'free {',
      '  form [ ]',
      '  name "名前"',
      '  nameBox [ ]',
      '  list [ ]',
      '}',
      'layout {',
      '  form @ (0, 0) 400x200',
      '  grid form (gap: 12; pad: 16; cols: 120, 1fr) {',
      '    name;nameBox',
      '    . ; list',
      '  }',
      '}',
    );
    expect(formatDiagram(typed).text).toContain(lines(
      '  grid form (cols: 120, 1fr) {',
      '    name ; nameBox',
      '    .    ; list',
      '  }',
    ));
  });

  it('keeps parts and callouts in the order they were written', () => {
    const parts = lines('parts {', '  b [ ] {line:#000} 10x10', '  a ( )   20x20', '}');
    expect(formatDiagram(parts).text).toBe(lines(
      'parts {', '  b [ ] { line: #000 } 10x10', '  a ( )                20x20', '}',
    ));
    const overlay = lines('overlay "a.png" {', '  ② @ (10, 5) -> (100, 50) "二"', '  ① @ (1, 50) -> (10, 5)', '}');
    expect(formatDiagram(overlay).text).toBe(lines(
      'overlay "a.png" {', '  ② @ (10,  5) -> (100, 50)  "二"', '  ① @ ( 1, 50) -> ( 10,  5)', '}',
    ));
  });

  it('leaves a file alone when a name is written twice', () => {
    const typed = lines('free {', '  a [A]', '}', 'layout {', '  a @ (0, 0)', '  a @ (10, 0)', '}');
    const formatted = formatDiagram(typed);
    expect(formatted.changed).toBe(false);
    expect(formatted.text).toBe(typed);
    expect(formatted.notes.map(note => note.id)).toEqual(['diagram.format.duplicate']);
  });

  it('keeps CRLF line endings', () => {
    const typed = 'free {\r\n  a[A]\r\n}\r\nlayout {\r\n  a @ (0,0)\r\n}\r\n';
    expect(formatDiagram(typed).text).toBe('free {\r\n  a [A]\r\n}\r\n\r\nlayout {\r\n  a @ (0, 0)\r\n}\r\n');
  });

  it('throws for a file that cannot be read', () => {
    expect(() => formatDiagram('free {\n  a [A\n}\n')).toThrow();
  });

  describe.each(drawings(SAMPLE).map(path => [path.slice(SAMPLE.length + 1), path]))('%s', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    const read = readerFor(path);
    const formatted = formatDiagram(source, read);

    it('formats without falling back', () => {
      expect(formatted.notes).toEqual([]);
    });
    it('draws the same picture', () => {
      expect(picture(formatted.text, read)).toBe(picture(source, read));
    });
    it('is unchanged by formatting again', () => {
      expect(formatDiagram(formatted.text, read).text).toBe(formatted.text);
    });
  });
});
