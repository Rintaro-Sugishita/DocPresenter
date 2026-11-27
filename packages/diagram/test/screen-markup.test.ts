import { describe, expect, it } from 'vitest';
import { parseDiagram, screenToHtml, screenToXaml, withParts, DEFAULT_LIBRARY, DEFAULT_PARTS } from '../src/index.js';

const screen = [
  `use "${DEFAULT_LIBRARY}"`,
  '',
  'free {',
  '  frame    frame:',
  '  title    title:"ログイン"',
  '  idField  ""',
  '  idLabel  label:"ID"',
  '  idBox    textbox:',
  '  keepRow  ""',
  '  keepBox  checkbox:',
  '  keepText label:"保持する"',
  '  people   list: {',
  '    - 山田*',
  '    - 鈴木',
  '  }',
  '  submit   primary:"送信"',
  '  note     label:"手で置いた注記"',
  '}',
  '',
  'layout {',
  '  frame @ (0, 0) 400x400',
  '  note @ (300, 360) 80x18',
  '  stack frame (down; gap: 10; pad: 20) { title ; idField ; keepRow ; people ; submit }',
  '  grid idField (cols: auto, 1fr; gap: 8; pad: 0) {',
  '    idLabel ; idBox',
  '  }',
  '  stack keepRow (right; gap: 6; pad: 0) { keepBox ; keepText }',
  '}',
  '',
].join('\n');

const drawing = () => withParts(parseDiagram(screen), path => (path === DEFAULT_LIBRARY ? DEFAULT_PARTS : undefined));

describe('画面を XAML（WPF）にする', () => {
  it('stack は StackPanel、grid は Grid、部品はそのコントロールになる', () => {
    const xaml = screenToXaml(drawing(), { title: 'ログイン', className: 'App.LoginWindow' });
    expect(xaml).toContain('<Window x:Class="App.LoginWindow"');
    expect(xaml).toContain('<StackPanel Margin="20">');
    expect(xaml).toMatch(/<Grid x:Name="idField"[^>]*>/);
    expect(xaml).toContain('<ColumnDefinition Width="Auto" />');
    expect(xaml).toContain('<ColumnDefinition Width="*" />');
    expect(xaml).toMatch(/<TextBox x:Name="idBox" Grid.Row="0" Grid.Column="1"/);
    // The check box takes the words drawn beside it.
    expect(xaml).toMatch(/<CheckBox x:Name="keepBox"[^>]*Content="保持する"/);
    expect(xaml).not.toContain('x:Name="keepText"');
    expect(xaml).toContain('<ListBoxItem Content="山田" IsSelected="True" />');
    expect(xaml).toMatch(/<Button x:Name="submit"[^>]*Content="送信" IsDefault="True"/);
  });

  it('並べ方の無いものは、描いた位置に Canvas で置く', () => {
    const xaml = screenToXaml(drawing());
    expect(xaml).toMatch(/<TextBlock x:Name="note" Canvas.Left="300" Canvas.Top="360"/);
  });
});

describe('画面を HTML にする', () => {
  it('並びは flex と grid、部品はフォームの要素になる', () => {
    const html = screenToHtml(drawing(), { title: 'ログイン', locale: 'ja' });
    expect(html).toContain('<h1 id="title"');
    expect(html).toContain('grid-template-columns:auto 1fr');
    expect(html).toContain('<input id="idBox" type="text"');
    expect(html).toContain('<input id="keepBox" type="checkbox"> 保持する</label>');
    expect(html).toContain('<button id="submit" type="button" class="primary"');
    expect(html).toContain('position:absolute;left:300px;top:360px');
  });
});
