import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import {
  DiagramEditError, followLabel, formatDiagram, itemName, itemShapes, itemTableName, layOutDiagram, linkItemTable,
  itemCellChoices, itemTypes, newItemTable, parseDiagram, readItemTable, readingOrder, renderDiagram, setItemCell,
  starterScreen, syncItemTable, withParts,
} from '../src/index.js';

// The login screen of the sample, cut down to what the item list is about.
const SCREEN = [
  'use "default"',
  'items "items.table"',
  '',
  'free {',
  '  frame    frame:',
  '  title    title:"ログイン"',
  '  idField  ""',
  '  idLabel  label:"ログイン ID"',
  '  idBox    textbox:',
  '  pwField  ""',
  '  pwLabel  label:"パスワード"',
  '  pwBox    textbox:',
  '  keepRow  ""',
  '  keepBox  checkbox:',
  '  keepText label:"保持する"',
  '  submit   primary:"ログイン"',
  '}',
  '',
  'layout {',
  '  frame @ (40, 20) 380x360',
  '  stack frame (down; gap: 20; pad: 30) { title ; idField ; pwField ; keepRow ; submit }',
  '  stack idField (down; gap: 2; pad: 0) { idLabel ; idBox }',
  '  stack pwField (down; gap: 2; pad: 0) { pwLabel ; pwBox }',
  '  stack keepRow (right; gap: 8; pad: 0) { keepBox ; keepText }',
  '}',
  '',
].join('\n');

const TABLE = [
  '# 項目定義',
  '',
  '| 分類 | No | ID      | 項目名      | 必須 | 寄せ | 説明 |',
  '|------|---:|---------|------------|:----:|:----:|------|',
  '| 入力 |  # | idBox   | ログイン ID |  ○   |      | 必須 |',
  '| ^    |  # | pwBox   | パスワード  |  ○   |  右  |      |',
  '| ^    |  # | keepBox | 保持        |  —   |      |      |',
  '| 操作 |  # | submit  | ログイン    |  —   |      |      |',
  '| 表示 |  — |         | メッセージ  |  —   |      |      |',
  '',
].join('\n');

const screen = (table: string | undefined = TABLE, source = SCREEN) =>
  withParts(parseDiagram(source), path => (path === 'items.table' ? table : undefined));

const notes = (table: string | undefined, source?: string): string[] =>
  layOutDiagram(withParts(parseDiagram(source ?? SCREEN), path => (path === 'items.table' ? table : undefined)))
    .notes.map(note => note.id);
/** The text a byte range of the screen covers. */
const at = (span: { start: number; end: number } | undefined): string =>
  Buffer.from(SCREEN).subarray(span!.start, span!.end).toString();

describe('the item table a screen names', () => {
  it('is read from its own line and kept there by the formatter', () => {
    const file = parseDiagram(SCREEN);
    expect(file.itemTable?.path).toBe('items.table');
    expect(at(file.itemTable!.span)).toBe('items "items.table"');
    const formatted = formatDiagram(SCREEN).text;
    expect(formatted).toContain('items "items.table"');
    expect(parseDiagram(formatted).itemTable?.path).toBe('items.table');
  });

  it('reads the screen in the order its containers hold it', () => {
    expect(readingOrder(screen()).filter(id => /Box|submit/.test(id)))
      .toEqual(['idBox', 'pwBox', 'keepBox', 'submit']);
  });

  it('takes which shapes are items, and of what kind, from the parts', () => {
    expect([...itemShapes(screen())]).toEqual([
      ['idBox', '入力'], ['pwBox', '入力'], ['keepBox', '入力'], ['submit', '操作'],
    ]);
  });

  // A screen drawn with no library holds the shipped pictures themselves.
  it('takes a shipped picture of a control as an item, with no library', () => {
    const plain = 'free {\n  part1 "選択"\n  logo [ロゴ]\n  rule "x"\n}\n\nstyle {\n'
      + '  part1 { icon: ui/check-on }\n  rule { icon: ui/scrollbar-v }\n}\n';
    const file = withParts(parseDiagram(plain), () => undefined);
    expect([...itemShapes(file)]).toEqual([['part1', '入力']]);
    expect(newItemTable(file)).toMatch(/\| 入力 +\| # +\| part1 +\| 選択 +\|/);
  });

  // A library that restyles a button has not said it stopped being one.
  it('keeps a part an item when a library restyles it', () => {
    const library = 'use "default"\n\nparts {\n  primary ( ) { fill: #000000 } 200x30\n}\n';
    const file = withParts(parseDiagram(SCREEN.replace('use "default"', 'use "mine.dgm"')),
      path => (path === 'mine.dgm' ? library : path === 'items.table' ? TABLE : undefined));
    expect(itemShapes(file).get('submit')).toBe('操作');
  });

  it('names an item by the caption beside it, or by its own words', () => {
    const file = screen();
    expect(itemName(file, 'idBox')).toBe('ログイン ID');
    // A check box comes first in its row, so its words come after it.
    expect(itemName(file, 'keepBox')).toBe('保持する');
    expect(itemName(file, 'submit')).toBe('ログイン');
  });

  // What a text box shows is a sample of what will be typed there, not its name.
  it('does not name an input by the sample written in it', () => {
    const plain = 'use "default"\n\nfree {\n  mail textbox:"yamada@example.co.jp"\n'
      + '  note error:"ID またはパスワードが違います"\n  ok primary:"送信"\n}\n';
    const file = withParts(parseDiagram(plain), () => undefined);
    expect(itemName(file, 'mail')).toBe('');
    expect(itemName(file, 'note')).toBe('');
    expect(itemName(file, 'ok')).toBe('送信');
  });

  it('numbers the items in the screen\'s order and marks the required ones', () => {
    const links = screen().itemLinks!.links;
    expect([...links.values()].map(link => [link.id, link.number, link.required])).toEqual([
      ['idBox', 1, true], ['pwBox', 2, true], ['keepBox', 3, false], ['submit', 4, false],
    ]);
    expect(links.get('idBox')?.label).toBe('idLabel');
  });

  it('gives the item the alignment the table writes', () => {
    expect(screen().style.get('pwBox')?.get('align')).toBe('right');
    expect(screen().style.get('idBox')?.get('align')).toBe('left');
  });

  it('draws a number on each item and a mark after each required caption', () => {
    const file = screen();
    const laid = layOutDiagram(file);
    expect(laid.marks.filter(mark => mark.kind === 'number').map(mark => mark.text)).toEqual(['1', '2', '3', '4']);
    const required = laid.marks.filter(mark => mark.kind === 'required');
    expect(required.map(mark => [mark.id, mark.text])).toEqual([['idBox', '*'], ['pwBox', '*']]);
    // After the caption's words, on the caption's line.
    const caption = laid.boxes.get('idLabel')!;
    expect(required[0]!.x).toBeGreaterThan(caption.x + 8);
    expect(required[0]!.x).toBeLessThan(caption.x + caption.width / 2);
    expect(required[0]!.y + required[0]!.height / 2).toBeCloseTo(caption.y + caption.height / 2);
    const svg = renderDiagram(file);
    expect(svg).toContain('class="dp-item-number" data-item="idBox"');
    expect(svg).toContain('class="dp-item-required" data-item="pwBox"');
  });

  // How "required" looks is the product's: a part named `required` says it.
  it('draws "required" as the library\'s part when it has one', () => {
    const source = SCREEN.replace('free {', 'parts {\n  required "必須" { fill: #b3261e, color: #ffffff } 32x16\n}\n\nfree {');
    const marks = layOutDiagram(screen(TABLE, source)).marks.filter(mark => mark.kind === 'required');
    expect(marks[0]).toMatchObject({ text: '必須', width: 32, height: 16 });
    expect(marks[0]!.style.get('fill')).toBe('#b3261e');
  });

  it('says nothing when the screen and the table agree', () => {
    expect(notes(TABLE)).toEqual([]);
  });

  it('says what did not join, and where', () => {
    const table = TABLE
      .replace('| ^    |  # | keepBox |', '| ^    |  # | gone    |')
      .replace('|  ○   |  右  |', '|  たぶん |  斜め |');
    const found = layOutDiagram(screen(table)).notes;
    expect(found.map(note => note.id)).toEqual(expect.arrayContaining([
      'diagram.items.missingShape', 'diagram.items.unlisted', 'diagram.items.badRequired', 'diagram.items.badAlign',
    ]));
    // A row naming no shape is marked on the line that names the table.
    const missing = found.find(note => note.id === 'diagram.items.missingShape')!;
    expect(at(missing.span)).toBe('items "items.table"');
    // An item the table lacks is marked on its own line.
    const unlisted = found.find(note => note.id === 'diagram.items.unlisted')!;
    expect(at(unlisted.span)).toContain('keepBox');
  });

  it('says when the table is in another order than the screen', () => {
    const lines = TABLE.split('\n');
    [lines[4], lines[5]] = [lines[5]!.replace('| ^    |', '| 入力 |'), lines[4]!.replace('| 入力 |', '| ^    |')];
    expect(notes(lines.join('\n'))).toContain('diagram.items.order');
  });

  it('says when the table cannot be read, or has no ID column', () => {
    expect(notes(undefined)).toEqual(['diagram.items.unreadable']);
    expect(notes('| a | b |\n|---|---|\n| 1 | 2 |\n')).toEqual(['diagram.items.noIdColumn']);
    expect(notes(`${TABLE}| 表示 |  — | idBox | 重複 | — | | |\n`)).toContain('diagram.items.duplicate');
  });
});

describe('matching the item table to the screen', () => {
  it('changes nothing when they already match', () => {
    expect(syncItemTable(screen(), TABLE)).toBeUndefined();
  });

  it('adds a row for an item the table lacks, where the screen has it', () => {
    const table = TABLE.replace(/\| \^ {4}\| {2}# \| keepBox [^\n]*\n/, '');
    const edit = syncItemTable(screen(table), table)!;
    expect(edit.path).toBe('items.table');
    const after = applyEdit(table, edit);
    const rows = after.split('\n').filter(line => line.startsWith('|')).slice(2);
    expect(rows.map(row => row.split('|')[3]!.trim())).toEqual(['idBox', 'pwBox', 'keepBox', 'submit', '']);
    // A new row says what the screen says: its number, its kind, its name. The
    // kind is the same as the row above, which merges with it.
    expect(rows[2]).toMatch(/^\| \^ +\| # +\| keepBox +\| 保持する +\|/);
    // The rows nobody touched are as they were.
    expect(after).toContain(TABLE.split('\n')[4]);
    expect(syncItemTable(screen(after), after)).toBeUndefined();
  });

  it('puts the rows in the screen\'s order, carrying the rows after each', () => {
    const lines = TABLE.split('\n');
    const moved = [...lines.slice(0, 4), lines[7], lines[8], lines[4], lines[5], lines[6], ''].join('\n');
    const after = applyEdit(moved, syncItemTable(screen(moved), moved)!);
    const rows = after.split('\n').filter(line => line.startsWith('|')).slice(2);
    expect(rows.map(row => row.split('|')[3]!.trim())).toEqual(['idBox', 'pwBox', 'keepBox', 'submit', '']);
    // The message row went with the row it followed; a `^` no longer under
    // what it merged with is written out.
    expect(rows[0]!.startsWith('| 入力 |')).toBe(true);
    expect(rows[3]!.startsWith('| 操作 |')).toBe(true);
    expect(rows[4]!.startsWith('| 表示 |')).toBe(true);
  });

  it('keeps a row whose item is gone, under the row it followed', () => {
    const table = TABLE.replace('| ^    |  # | keepBox |', '| ^    |  # | gone    |');
    const after = applyEdit(table, syncItemTable(screen(table), table)!);
    const ids = after.split('\n').filter(line => line.startsWith('|')).slice(2).map(row => row.split('|')[3]!.trim());
    expect(ids).toEqual(['idBox', 'pwBox', 'gone', 'keepBox', 'submit', '']);
  });

  it('fills an empty table', () => {
    const table = '| No | ID | 項目名 | 分類 |\n|---:|----|-------|------|\n';
    const after = applyEdit(table, syncItemTable(screen(table), table)!);
    expect(after.split('\n').slice(2, 6)).toEqual([
      '|  #  | idBox   | ログイン ID | 入力 |',
      '|  #  | pwBox   | パスワード  | 入力 |',
      '|  #  | keepBox | 保持する    | 入力 |',
      '|  #  | submit  | ログイン    | 操作 |',
    ].map(line => expect.stringMatching(new RegExp(`^${line.replace(/[|^]/g, '\\$&').replace(/ +/g, ' +')}$`))));
  });

  it('refuses a screen with no table, and a table with no ID column', () => {
    expect(() => syncItemTable(parseDiagram('free {\n  a [A]\n}\n'), TABLE)).toThrow(DiagramEditError);
    expect(() => syncItemTable(screen(), '| a |\n|---|\n')).toThrow(DiagramEditError);
  });
});

describe('making a screen\'s item table', () => {
  const bare = SCREEN.replace('items "items.table"\n', '');

  it('names it after the screen, beside it', () => {
    expect(itemTableName('docs/order/order-screen.dgm')).toBe('order-screen-items.table');
  });

  it('lists the screen\'s items in the screen\'s order, already in step', () => {
    const file = withParts(parseDiagram(bare), () => undefined);
    const table = newItemTable(file);
    const rows = table.split('\n').filter(line => line.startsWith('|')).slice(2);
    expect(rows.map(row => row.split('|')[3]!.trim())).toEqual(['idBox', 'pwBox', 'keepBox', 'submit']);
    // The same kind as the row above merges with it.
    expect(rows.map(row => row.split('|')[1]!.trim())).toEqual(['入力', '^', '^', '操作']);
    const linked = withParts(parseDiagram(SCREEN), path => (path === 'items.table' ? table : undefined));
    expect(syncItemTable(linked, table)).toBeUndefined();
    expect(layOutDiagram(linked).notes).toEqual([]);
    expect(newItemTable(file, 'en')).toContain('| Category | No');
  });

  it('names the table in the screen with one line, under its `use` lines', () => {
    const edit = linkItemTable(parseDiagram(bare), bare, 'items.table');
    expect(edit.span.start).toBe(edit.span.end);
    expect(applyEdit(bare, edit)).toBe(SCREEN);
    // With no `use` line, above the first section.
    const plain = 'free {\n  a [A]\n}\n';
    expect(applyEdit(plain, linkItemTable(parseDiagram(plain), plain, 'a.table')))
      .toBe('items "a.table"\n\nfree {\n  a [A]\n}\n');
  });

  it('refuses a screen that has one, and a drawing that is no screen', () => {
    expect(() => linkItemTable(parseDiagram(SCREEN), SCREEN, 'x.table')).toThrow(DiagramEditError);
    const flow = 'flow {\n  a --> b\n}\n';
    expect(() => linkItemTable(parseDiagram(flow), flow, 'x.table')).toThrow(DiagramEditError);
  });

  it('starts a new screen with its table named, and items to list', () => {
    const source = starterScreen('order-items.table');
    const file = withParts(parseDiagram(source), () => undefined);
    expect(file.itemTable?.path).toBe('order-items.table');
    expect([...itemShapes(file).keys()]).toEqual(['input', 'submit']);
    expect(itemName(file, 'input')).toBe('項目');
    expect(layOutDiagram(file).notes.map(note => note.id)).toEqual(['diagram.items.unreadable']);
  });
});

describe('writing one item\'s cell from the screen', () => {
  it('writes required the way the table already writes it, on one line', () => {
    const edit = setItemCell(screen(), TABLE, 'submit', 'required', true);
    const after = applyEdit(TABLE, edit);
    expect(after.split('\n')[7]).toMatch(/\| 操作 \|  # \| submit  \| ログイン    \| ○ +\|/);
    expect(after.split('\n').filter((line, i) => line !== TABLE.split('\n')[i])).toHaveLength(1);
    const off = applyEdit(TABLE, setItemCell(screen(), TABLE, 'idBox', 'required', false));
    expect(off.split('\n')[4]).toContain('| — ');
  });

  it('writes an alignment in the table\'s language, and clears it', () => {
    const after = applyEdit(TABLE, setItemCell(screen(), TABLE, 'idBox', 'align', 'center'));
    expect(screen(after).style.get('idBox')?.get('align')).toBe('center');
    expect(after.split('\n')[4]).toContain('| 中央 |');
    const cleared = applyEdit(TABLE, setItemCell(screen(), TABLE, 'pwBox', 'align', undefined));
    expect(screen(cleared).style.get('pwBox')?.get('align')).toBe('left');
  });

  it('refuses an item the table does not list, or a column it does not have', () => {
    expect(() => setItemCell(screen(), TABLE, 'title', 'required', true)).toThrow(DiagramEditError);
    const narrow = '| ID | 必須 |\n|----|------|\n| idBox | ○ |\n';
    expect(() => setItemCell(screen(narrow), narrow, 'idBox', 'align', 'left')).toThrow(DiagramEditError);
  });
});

describe('what a cell of the item table is offered', () => {
  const TYPED = [
    '| 分類 | ID      | 項目名 | 型            | 必須 | 寄せ |',
    '|------|---------|--------|---------------|:----:|:----:|',
    '| 入力 | idBox   | ID     | `varchar(64)` |  ○   |      |',
    '| ^    | pwBox   | PW     |               |  —   |  右  |',
    '| ^    | keepBox | 保持   |               |  ×?  |  上  |',
    '| 操作 | submit  | 送信   | —             |      |      |',
    '',
  ].join('\n');
  const grid = (source: string) => {
    const table = readItemTable(source)!;
    return { headers: table.headers, rows: table.rows.map(row => row.cells) };
  };

  it('offers yes and no for required, written the way the table writes them', () => {
    const { headers, rows } = grid(TYPED);
    const offer = itemCellChoices(headers, rows, 0, 4)!;
    expect(offer.closed).toBe(true);
    expect(offer.choices.map(one => one.text)).toEqual(['○', '—']);
    expect(offer.accepts('○')).toBe(true);
    expect(offer.accepts('×?')).toBe(false);
  });

  it('offers the sides for alignment, and empty for as the part has it', () => {
    const { headers, rows } = grid(TYPED);
    const offer = itemCellChoices(headers, rows, 0, 5)!;
    expect(offer.choices.map(one => one.text)).toEqual(['左', '中央', '右', '']);
    expect(offer.accepts('上')).toBe(false);
    expect(offer.accepts('')).toBe(true);
  });

  it('offers a type from the part first, then the types the tables use', () => {
    const { headers, rows } = grid(TYPED);
    const offer = itemCellChoices(headers, rows, 1, 3, {
      screen: screen(), otherTypes: () => ['`int`', '`varchar(64)`', '`int`'],
    })!;
    expect(offer.closed).toBe(false);
    // pwBox is a text box: the varchar this table already writes, then the bare guess.
    expect(offer.choices.map(one => one.text)).toEqual(['`varchar(64)`', '`varchar`', '`int`']);
    expect(offer.choices[1]!.detail).toBe('textbox から');
    const box = itemCellChoices(headers, rows, 2, 3, { screen: screen() })!;
    expect(box.choices[0]!.text).toBe('`bool`');
  });

  it('offers nothing for a column the screen does not read, or a table with no ID', () => {
    const { headers, rows } = grid(TYPED);
    expect(itemCellChoices(headers, rows, 0, 2)).toBeUndefined();
    expect(itemCellChoices(['名前', '必須'], [['a', '○']], 0, 1)).toBeUndefined();
  });

  it('reads the type cells of another item table', () => {
    expect(itemTypes(TYPED)).toEqual(['`varchar(64)`', '', '', '—']);
    expect(itemTypes('| 名前 | 型 |\n|---|---|\n| a | int |\n')).toEqual([]);
  });
});

describe('an item\'s name following its label', () => {
  it('renames the item while its name is still the label\'s words, and only then', () => {
    const edit = followLabel(screen(), TABLE, 'idBox', 'ログイン ID', 'ユーザー ID')!;
    expect(edit.path).toBe('items.table');
    const after = applyEdit(TABLE, edit);
    expect(after.split('\n')[4]).toContain('| ユーザー ID |');
    expect(after.split('\n').filter((line, i) => line !== TABLE.split('\n')[i])).toHaveLength(1);
    // 保持 was written apart from the screen's 保持する: it is left as it is.
    expect(followLabel(screen(), TABLE, 'keepBox', '保持する', '状態を保持する')).toBeUndefined();
    expect(followLabel(screen(), TABLE, 'idBox', 'ログイン ID', 'ログイン ID')).toBeUndefined();
  });
});
