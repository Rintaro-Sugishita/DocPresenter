// A screen drawing as the start of the real screen: HTML, or XAML for WPF.
//
// A `free` drawing of a screen already says what a programmer starts from:
// which controls there are, which of them go in a row or a column, which form
// a grid, what each is called. What it does not say — bindings, behaviour,
// the exact pixels — is the programmer's, so this writes a skeleton to start
// from, not a finished screen.
//
// The layout follows what the drawing arranged. A stack is a StackPanel (a
// flex box), a grid of rows and columns is a Grid (a CSS grid), tabs are a
// TabControl. What was only placed by hand on a panel has no arrangement to
// follow, so it is placed where it was drawn: a Canvas with Left and Top (an
// absolutely placed box). The controls come from the parts they were drawn
// with — a `textbox` is a TextBox, a `grid` a DataGrid, a `list` a ListBox —
// and a shape no part names is a box of text.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { containerOf, members } from '../arrange.js';
import { layOutDiagram, type Box } from '../layout.js';
import type { Container, DiagramFile, Item, Node } from '../model.js';

/** What a shape is, as a control. */
type Kind =
  | 'panel' | 'heading' | 'text' | 'hint' | 'error' | 'link' | 'mark'
  | 'input' | 'textarea' | 'select' | 'number' | 'slider' | 'check' | 'radio'
  | 'button' | 'datagrid' | 'list' | 'tree' | 'menu' | 'separator' | 'image' | 'box' | 'skip';

interface Control {
  readonly node: Node;
  readonly kind: Kind;
  /** Primary, secondary or danger, for a button; checked, for a check box. */
  readonly variant: string | undefined;
  /** The drawn box, relative to the control it is in. */
  readonly box: { x: number; y: number; width: number; height: number } | undefined;
  readonly children: Control[];
  /** How the children are laid out. */
  readonly layout: 'down' | 'right' | 'grid' | 'tabs' | 'table' | 'canvas';
  readonly container: Container | undefined;
  /** The picture a shape points at by path, as written in the drawing. */
  readonly picture: string | undefined;
}

const PART_KIND: Readonly<Record<string, Kind>> = {
  frame: 'panel', panel: 'panel', banner: 'panel', alert: 'panel',
  title: 'heading', label: 'text', body: 'text', hint: 'hint', error: 'error', link: 'link',
  required: 'mark', disabled: 'mark',
  textbox: 'input', textarea: 'textarea', select: 'select', spinner: 'number', slider: 'slider',
  checkbox: 'check', checked: 'check', radio: 'radio', selected: 'radio',
  primary: 'button', secondary: 'button', danger: 'button',
  grid: 'datagrid', list: 'list', tree: 'tree', menu: 'menu',
  divider: 'separator', dividerV: 'separator', pointer: 'skip', guide: 'skip',
  scrollbar: 'skip', scrollbarH: 'skip', image: 'image', icon: 'image',
};

const ICON_KIND: Readonly<Record<string, Kind>> = {
  'ui/select': 'select', 'ui/spinner': 'number', 'ui/slider': 'slider',
  'ui/check': 'check', 'ui/check-on': 'check', 'ui/radio': 'radio', 'ui/radio-on': 'radio',
  'ui/grid': 'datagrid', 'ui/tree': 'tree', 'ui/list': 'list', 'ui/menu': 'menu', 'ui/image': 'image',
};

function kindOf(file: DiagramFile, node: Node): { kind: Kind; variant: string | undefined } {
  const part = file.partOf.get(node.id);
  const icon = file.style.get(node.id)?.get('icon');
  // What arranges others is a panel whatever it looks like. One drawn as
  // nothing (`idField ""`) only groups, and is written as its layout alone.
  if (file.containers.has(node.id)) {
    const drawn = part !== undefined && PART_KIND[part] === 'panel';
    return { kind: 'panel', variant: drawn || node.shape === 'group' || node.shape === 'rect' ? undefined : 'bare' };
  }
  const variant = part === 'checked' || part === 'selected' || icon === 'ui/check-on' || icon === 'ui/radio-on'
    ? 'checked' : part === 'primary' || part === 'secondary' || part === 'danger' ? part : undefined;
  if (part !== undefined && PART_KIND[part] !== undefined) return { kind: PART_KIND[part]!, variant };
  if (icon !== undefined && ICON_KIND[icon] !== undefined) return { kind: ICON_KIND[icon]!, variant };
  if (icon !== undefined && /\.(svg|png|jpe?g|gif|webp)$/i.test(icon)) return { kind: 'image', variant };
  if (node.shape === 'group') return { kind: 'panel', variant };
  if (node.shape === 'line') return { kind: 'separator', variant };
  if (node.shape === 'stadium' || node.shape === 'round-rect') return { kind: node.text === '' ? 'panel' : 'button', variant };
  if (node.shape === 'text') return { kind: 'text', variant };
  return { kind: node.text === '' ? 'panel' : 'box', variant };
}

/** The drawing's controls, nested as they are on the screen. */
function controlsOf(file: DiagramFile, locale: Locale): { roots: Control[]; width: number; height: number } {
  const laid = layOutDiagram(file, locale);
  const boxes = laid.boxes;
  const held = containerOf(file);
  const parent = new Map<string, string>(held);
  for (const node of file.nodes) {
    if (node.shape === 'group') for (const child of node.children) if (!parent.has(child)) parent.set(child, node.id);
  }
  const kinds = new Map(file.nodes.map(node => [node.id, kindOf(file, node)]));
  // A shape placed by hand on a panel is on that panel: the smallest that holds it.
  // Not one that arranges what it holds: what it holds is what it arranges.
  const panels = file.nodes.filter(node => kinds.get(node.id)!.kind === 'panel' && boxes.has(node.id)
    && !file.containers.has(node.id));
  const inside = (inner: Box, outer: Box): boolean => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5
    && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
  const ancestors = (id: string): Set<string> => {
    const seen = new Set<string>();
    for (let at = parent.get(id); at !== undefined && !seen.has(at); at = parent.get(at)) seen.add(at);
    return seen;
  };
  for (const node of file.nodes) {
    if (parent.has(node.id)) continue;
    const box = boxes.get(node.id);
    if (!box) continue;
    let best: Node | undefined;
    for (const panel of panels) {
      if (panel.id === node.id) continue;
      const outer = boxes.get(panel.id)!;
      if (!inside(box, outer) || ancestors(panel.id).has(node.id)) continue;
      if (outer.width * outer.height <= box.width * box.height && !(outer.width === box.width && outer.height === box.height)) continue;
      const area = outer.width * outer.height;
      if (!best || area < boxes.get(best.id)!.width * boxes.get(best.id)!.height) best = panel;
    }
    if (best) parent.set(node.id, best.id);
  }

  const build = (node: Node, origin: { x: number; y: number }): Control => {
    const box = boxes.get(node.id);
    const own = box ? { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height } : undefined;
    const container = file.containers.get(node.id);
    const order = container ? members(container) : file.nodes.filter(one => parent.get(one.id) === node.id).map(one => one.id);
    const children = order.map(id => file.nodes.find(one => one.id === id))
      .filter((one): one is Node => one !== undefined && kinds.get(one.id)!.kind !== 'skip')
      .map(child => build(child, box ? { x: box.x, y: box.y } : origin));
    const layout = !container ? 'canvas'
      : container.kind === 'tabs' ? 'tabs'
        : container.kind === 'grid' ? (container.names.some(name => name !== undefined) && container.head > 0 ? 'table' : 'grid')
          : container.flow;
    const icon = file.style.get(node.id)?.get('icon');
    return {
      node, ...kinds.get(node.id)!, box: own, children, layout, container,
      picture: icon !== undefined && /\.(svg|png|jpe?g|gif|webp)$/i.test(icon) ? icon : undefined,
    };
  };
  const roots = file.nodes
    .filter(node => !parent.has(node.id) && kinds.get(node.id)!.kind !== 'skip')
    .map(node => build(node, laid.origin));
  return { roots, width: laid.width, height: laid.height };
}

/** Where a member sits in a grid: its row and column, and how far it spans. */
function cellOf(container: Container, id: string): { row: number; column: number; rows: number; columns: number } {
  let top = Infinity; let left = Infinity; let bottom = -1; let right = -1;
  container.cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell !== id) return;
    top = Math.min(top, r); left = Math.min(left, c); bottom = Math.max(bottom, r); right = Math.max(right, c);
  }));
  if (bottom < 0) return { row: 0, column: 0, rows: 1, columns: 1 };
  return { row: top, column: left, rows: bottom - top + 1, columns: right - left + 1 };
}

function columnCount(container: Container): number {
  return Math.max(container.cols.length, ...container.cells.map(row => row.length), 1);
}

const round = (value: number): number => Math.round(value);

// --- HTML ---------------------------------------------------------------------

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

function htmlId(id: string): string {
  return escapeHtml(id);
}

function cssTrack(track: string | undefined): string {
  if (track === undefined || track === '') return '1fr';
  if (/^\d+(\.\d+)?$/.test(track)) return `${track}px`;
  return track;
}

function listItems(items: readonly Item[], tag: 'li' | 'option'): string {
  return items.map(item => tag === 'option'
    ? `<option${item.picked ? ' selected' : ''}>${escapeHtml(item.text)}</option>`
    : `<li style="padding-left:${item.depth * 16}px"${item.picked ? ' aria-selected="true"' : ''}>${escapeHtml(item.text)}</li>`).join('');
}

function htmlOf(control: Control, place: string, indent: string): string {
  const { node, kind } = control;
  const id = ` id="${htmlId(node.id)}"`;
  const style = place === '' ? '' : ` style="${place}"`;
  const text = escapeHtml(node.text);
  const inner = indent + '  ';
  switch (kind) {
    case 'heading': return `${indent}<h1${id}${style}>${text}</h1>`;
    case 'text': case 'box': return `${indent}<p${id} class="${kind}"${style}>${text}</p>`;
    case 'hint': return `${indent}<p${id} class="hint"${style}>${text}</p>`;
    case 'error': return `${indent}<p${id} class="error" role="alert"${style}>${text}</p>`;
    case 'mark': return `${indent}<span${id} class="mark"${style}>${text}</span>`;
    case 'link': return `${indent}<a${id} href="#"${style}>${text}</a>`;
    case 'input': return `${indent}<input${id} type="text" placeholder="${text}"${style}>`;
    case 'textarea': return `${indent}<textarea${id} placeholder="${text}"${style}></textarea>`;
    case 'select': return `${indent}<select${id}${style}>${listItems(node.items, 'option') || `<option>${text}</option>`}</select>`;
    case 'number': return `${indent}<input${id} type="number"${style}>`;
    case 'slider': return `${indent}<input${id} type="range"${style}>`;
    case 'check': case 'radio':
      return `${indent}<label${style}><input${id} type="${kind === 'check' ? 'checkbox' : 'radio'}"`
        + `${control.variant === 'checked' ? ' checked' : ''}> ${text}</label>`;
    case 'button': return `${indent}<button${id} type="button" class="${control.variant ?? 'secondary'}"${style}>${text}</button>`;
    case 'datagrid': return `${indent}<table${id} class="data"${style}><thead><tr><th>${text}</th></tr></thead><tbody></tbody></table>`;
    case 'list': case 'menu':
      return `${indent}<ul${id} class="${kind}"${style}>${listItems(node.items, 'li')}</ul>`;
    case 'tree': return `${indent}<ul${id} class="tree" role="tree"${style}>${listItems(node.items, 'li')}</ul>`;
    case 'separator': return `${indent}<hr${id}${style}>`;
    case 'image': return `${indent}<img${id} src="${escapeHtml(control.picture ?? '')}" alt="${text}"${style}>`;
    case 'skip': return '';
    case 'panel': break;
  }
  const { layout, container } = control;
  let arranged = '';
  let children: string[];
  if (layout === 'canvas') {
    arranged = 'position:relative;';
    children = control.children.map(child => htmlOf(child, child.box
      ? `position:absolute;left:${round(child.box.x)}px;top:${round(child.box.y)}px;width:${round(child.box.width)}px;height:${round(child.box.height)}px` : '', inner));
  } else if (layout === 'grid' || layout === 'table') {
    const columns = Array.from({ length: columnCount(container!) }, (_, n) => cssTrack(container!.cols[n])).join(' ');
    arranged = `display:grid;grid-template-columns:${columns};gap:${container!.gap.y}px ${container!.gap.x}px;padding:${container!.pad}px;`;
    children = control.children.map(child => {
      const at = cellOf(container!, child.node.id);
      return htmlOf(child, `grid-row:${at.row + 1} / span ${at.rows};grid-column:${at.column + 1} / span ${at.columns}`, inner);
    });
  } else if (layout === 'tabs') {
    const tabs = control.children.map((child, n) =>
      `${inner}<button type="button" role="tab" aria-selected="${n === 0}">${escapeHtml(child.node.text || child.node.id)}</button>`);
    children = [`${inner}<div role="tablist">`, ...tabs.map(one => `  ${one}`), `${inner}</div>`,
      ...control.children.map((child, n) => htmlOf(child, n === 0 ? '' : 'display:none', inner))];
  } else {
    arranged = `display:flex;flex-direction:${layout === 'down' ? 'column' : 'row'};gap:${container!.gap.y}px;padding:${container!.pad}px;`;
    children = paired(control.children).map(child => htmlOf(child, '', inner));
  }
  const scroll = container && container.scroll !== 'none' ? 'overflow:auto;' : '';
  const size = place === '' && control.box ? `width:${round(control.box.width)}px;min-height:${round(control.box.height)}px;` : '';
  const all = `${arranged}${scroll}${size}${place}`;
  const heading = node.text === '' ? '' : `${inner}<h2>${text}</h2>\n`;
  if (control.variant === 'bare') {
    return `${indent}<div${id}${all === '' ? '' : ` style="${all}"`}>\n${heading}${children.filter(one => one !== '').join('\n')}\n${indent}</div>`;
  }
  return `${indent}<section${id} class="panel"${all === '' ? '' : ` style="${all}"`}>\n${heading}${children.filter(one => one !== '').join('\n')}\n${indent}</section>`;
}

/** The screen as an HTML page: the controls, arranged as drawn, with a plain stylesheet. */
export function screenToHtml(file: DiagramFile, options: { title?: string; locale?: Locale } = {}): string {
  const { roots, width, height } = controlsOf(file, options.locale ?? DEFAULT_LOCALE);
  const body = roots.length === 1
    ? htmlOf(roots[0]!, '', '  ')
    : `  <main style="position:relative;width:${round(width)}px;height:${round(height)}px">\n${roots.map(root => htmlOf(root, root.box
      ? `position:absolute;left:${round(root.box.x)}px;top:${round(root.box.y)}px;width:${round(root.box.width)}px;height:${round(root.box.height)}px` : '', '    ')).join('\n')}\n  </main>`;
  return `<!doctype html>
<html lang="${options.locale ?? DEFAULT_LOCALE}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title ?? '')}</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 14px; color: #1c1f24; margin: 16px; }
  .panel { box-sizing: border-box; border: 1px solid #d3d7dd; border-radius: 4px; }
  .panel > h2 { font-size: 1em; margin: 0 0 8px; }
  h1 { font-size: 1.3em; margin: 0; }
  p { margin: 0; }
  .hint { color: #8b929c; font-size: .9em; }
  .error { color: #b3261e; }
  .mark { color: #b3261e; }
  input, select, textarea, button { box-sizing: border-box; font: inherit; }
  button.primary { background: #2f6fb5; color: #fff; border: 1px solid #2f6fb5; }
  button.danger { background: #b3261e; color: #fff; border: 1px solid #b3261e; }
  table.data { border-collapse: collapse; } table.data th, table.data td { border: 1px solid #d3d7dd; padding: 2px 6px; }
  ul.list, ul.tree, ul.menu { list-style: none; margin: 0; padding: 0; border: 1px solid #d3d7dd; overflow: auto; }
  ul.menu { display: flex; gap: 12px; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

// --- XAML (WPF) ---------------------------------------------------------------

const escapeXml = (text: string): string =>
  text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

/** A shape's id as an `x:Name`: XAML names are letters, digits and underscores. */
function xamlName(id: string): string {
  const name = id.replace(/[^\p{L}\p{N}_]/gu, '_');
  return /^[\p{L}_]/u.test(name) ? name : `_${name}`;
}

function xamlTrack(track: string | undefined): string {
  if (track === undefined || track === '') return '*';
  if (track === 'auto') return 'Auto';
  const share = /^(\d*(?:\.\d+)?)fr$/.exec(track);
  if (share) return share[1] === '' || share[1] === '1' ? '*' : `${share[1]}*`;
  return /^\d+(\.\d+)?$/.test(track) ? track : '*';
}

/** Rows of a tree, nested by how far in each is. */
function treeItems(items: readonly Item[], indent: string): string[] {
  const out: string[] = [];
  const open: number[] = [];
  items.forEach((item, n) => {
    while (open.length > 0 && open[open.length - 1]! >= item.depth) {
      open.pop();
      out.push(`${indent}${'  '.repeat(open.length)}</TreeViewItem>`);
    }
    const next = items[n + 1];
    const parent = next !== undefined && next.depth > item.depth;
    const pad = `${indent}${'  '.repeat(open.length)}`;
    const head = `<TreeViewItem Header="${escapeXml(item.text)}"${item.closed ? '' : parent ? ' IsExpanded="True"' : ''}${item.picked ? ' IsSelected="True"' : ''}`;
    if (parent) { out.push(`${pad}${head}>`); open.push(item.depth); } else out.push(`${pad}${head} />`);
  });
  while (open.length > 0) { open.pop(); out.push(`${indent}${'  '.repeat(open.length)}</TreeViewItem>`); }
  return out;
}

function xamlOf(control: Control, place: string, indent: string): string {
  const { node, kind } = control;
  const name = ` x:Name="${xamlName(node.id)}"`;
  const at = place === '' ? '' : ` ${place}`;
  const text = escapeXml(node.text);
  const inner = `${indent}  `;
  const sized = control.box && place.includes('Canvas.') ? ` Width="${round(control.box.width)}" Height="${round(control.box.height)}"` : '';
  switch (kind) {
    case 'heading': return `${indent}<TextBlock${name}${at} Text="${text}" FontSize="18" FontWeight="SemiBold" />`;
    case 'text': case 'box': case 'mark':
      return `${indent}<TextBlock${name}${at}${sized} Text="${text}" TextWrapping="Wrap" VerticalAlignment="Center"${kind === 'mark' ? ' Foreground="#B3261E"' : ''} />`;
    case 'hint': return `${indent}<TextBlock${name}${at} Text="${text}" Foreground="#8B929C" TextWrapping="Wrap" />`;
    case 'error': return `${indent}<TextBlock${name}${at} Text="${text}" Foreground="#B3261E" TextWrapping="Wrap" />`;
    case 'link': return `${indent}<TextBlock${name}${at}><Hyperlink>${text}</Hyperlink></TextBlock>`;
    case 'input': return `${indent}<TextBox${name}${at}${sized} />${text === '' ? '' : `<!-- ${text} -->`}`;
    case 'textarea': return `${indent}<TextBox${name}${at}${sized} AcceptsReturn="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" />`;
    case 'select':
      return node.items.length === 0 ? `${indent}<ComboBox${name}${at}${sized} />`
        : [`${indent}<ComboBox${name}${at}${sized}>`, ...node.items.map(item =>
          `${inner}<ComboBoxItem Content="${escapeXml(item.text)}"${item.picked ? ' IsSelected="True"' : ''} />`), `${indent}</ComboBox>`].join('\n');
    case 'number': return `${indent}<TextBox${name}${at}${sized} InputScope="Number" />`;
    case 'slider': return `${indent}<Slider${name}${at}${sized} />`;
    case 'check': return `${indent}<CheckBox${name}${at} Content="${text}"${control.variant === 'checked' ? ' IsChecked="True"' : ''} VerticalAlignment="Center" />`;
    case 'radio': return `${indent}<RadioButton${name}${at} Content="${text}"${control.variant === 'checked' ? ' IsChecked="True"' : ''} VerticalAlignment="Center" />`;
    case 'button': return `${indent}<Button${name}${at}${sized} Content="${text}"${control.variant === 'primary' ? ' IsDefault="True"' : ''} Padding="12,4" />`;
    case 'datagrid': return `${indent}<DataGrid${name}${at}${sized} AutoGenerateColumns="True" IsReadOnly="True" />`;
    case 'list':
      return node.items.length === 0 ? `${indent}<ListBox${name}${at}${sized} />`
        : [`${indent}<ListBox${name}${at}${sized}>`, ...node.items.map(item =>
          `${inner}<ListBoxItem Content="${escapeXml(item.text)}"${item.picked ? ' IsSelected="True"' : ''} />`), `${indent}</ListBox>`].join('\n');
    case 'tree': return [`${indent}<TreeView${name}${at}${sized}>`, ...treeItems(node.items, inner), `${indent}</TreeView>`].join('\n');
    case 'menu':
      return [`${indent}<Menu${name}${at}>`, ...node.items.filter(item => item.depth === 0).map(item =>
        `${inner}<MenuItem Header="${escapeXml(item.text)}" />`), `${indent}</Menu>`].join('\n');
    case 'separator': return `${indent}<Separator${name}${at} />`;
    case 'image': return `${indent}<Image${name}${at}${sized} Source="${escapeXml(control.picture ?? '')}" Stretch="Uniform" />`;
    case 'skip': return '';
    case 'panel': break;
  }
  const { layout, container } = control;
  const pad = container ? container.pad : 8;
  const scrolled = container !== undefined && container.scroll !== 'none';
  // A panel drawn as nothing is only its layout: the layout panel is the
  // shape, named and placed as it was, with no frame around it.
  const bare = control.variant === 'bare' && !scrolled;
  const lead = bare ? indent : scrolled ? `${inner}  ` : inner;
  const own = bare ? `${name}${at}` : '';
  /** The panel's own margin, unless where it is placed gives one already. */
  const margin = (value: number): string => (bare && at.includes('Margin=') ? '' : value > 0 ? ` Margin="${value}"` : '');
  const body: string[] = [];
  if (layout === 'canvas') {
    body.push(`${lead}<Canvas${own}${control.box ? ` Width="${round(control.box.width)}" Height="${round(control.box.height)}"` : ''}>`);
    for (const child of control.children) {
      body.push(xamlOf(child, child.box ? `Canvas.Left="${round(child.box.x)}" Canvas.Top="${round(child.box.y)}"` : '', `${lead}  `));
    }
    body.push(`${lead}</Canvas>`);
  } else if (layout === 'grid') {
    const rows = container!.cells.length;
    body.push(`${lead}<Grid${own}${margin(pad)}>`, `${lead}  <Grid.ColumnDefinitions>`);
    for (let n = 0; n < columnCount(container!); n++) body.push(`${lead}    <ColumnDefinition Width="${xamlTrack(container!.cols[n])}" />`);
    body.push(`${lead}  </Grid.ColumnDefinitions>`, `${lead}  <Grid.RowDefinitions>`);
    for (let n = 0; n < rows; n++) body.push(`${lead}    <RowDefinition Height="Auto" />`);
    body.push(`${lead}  </Grid.RowDefinitions>`);
    for (const child of control.children) {
      const cell = cellOf(container!, child.node.id);
      const where = [`Grid.Row="${cell.row}"`, `Grid.Column="${cell.column}"`,
        ...(cell.rows > 1 ? [`Grid.RowSpan="${cell.rows}"`] : []), ...(cell.columns > 1 ? [`Grid.ColumnSpan="${cell.columns}"`] : []),
        ...(container!.gap.x + container!.gap.y > 0 ? [`Margin="${container!.gap.x / 2},${container!.gap.y / 2}"`] : [])].join(' ');
      body.push(xamlOf(child, where, `${lead}  `));
    }
    body.push(`${lead}</Grid>`);
  } else if (layout === 'table') {
    // A table drawn on the screen: its heading row is the DataGrid's columns.
    body.push(`${lead}<DataGrid${own} AutoGenerateColumns="False" IsReadOnly="True">`, `${lead}  <DataGrid.Columns>`);
    const heads = container!.cells[0] ?? [];
    heads.forEach((cell, n) => {
      const header = shapeIn(control, cell)?.text || container!.names[n] || `Column${n + 1}`;
      body.push(`${lead}    <DataGridTextColumn Header="${escapeXml(header)}" Binding="{Binding ${xamlName(container!.names[n] ?? `Column${n + 1}`)}}" />`);
    });
    body.push(`${lead}  </DataGrid.Columns>`, `${lead}</DataGrid>`);
  } else if (layout === 'tabs') {
    body.push(`${lead}<TabControl${own}>`);
    for (const child of control.children) {
      body.push(`${lead}  <TabItem Header="${escapeXml(child.node.text || child.node.id)}">`);
      body.push(xamlOf({ ...child, node: { ...child.node, text: '' } }, '', `${lead}    `));
      body.push(`${lead}  </TabItem>`);
    }
    body.push(`${lead}</TabControl>`);
  } else {
    body.push(`${lead}<StackPanel${own}${layout === 'right' ? ' Orientation="Horizontal"' : ''}${margin(pad)}>`);
    const gap = container!.gap.y;
    const spaced = gap > 0 ? (layout === 'right' ? `Margin="0,0,${gap},0"` : `Margin="0,0,0,${gap}"`) : '';
    for (const child of paired(control.children)) {
      // Across a row, a field takes only the width it was drawn: a row of a
      // text box and a slider would otherwise give each nothing.
      const wide = layout === 'right' && child.box !== undefined && !['text', 'check', 'radio', 'mark', 'link'].includes(child.kind);
      const where = wide ? `${spaced} Width="${round(child.box!.width)}"`.trim() : spaced;
      body.push(xamlOf(child, where, `${lead}  `));
    }
    body.push(`${lead}</StackPanel>`);
  }
  if (bare) return body.join('\n');
  const content = scrolled
    ? [`${inner}<ScrollViewer VerticalScrollBarVisibility="Auto"${container!.scroll === 'right' || container!.scroll === 'both' ? ' HorizontalScrollBarVisibility="Auto"' : ''}>`,
      ...body, `${inner}</ScrollViewer>`]
    : body;
  if (node.text !== '' && layout !== 'tabs') {
    return [`${indent}<GroupBox${name}${at}${sized} Header="${text}">`, ...content, `${indent}</GroupBox>`].join('\n');
  }
  return [`${indent}<Border${name}${at}${sized} BorderBrush="#D3D7DD" BorderThickness="1" CornerRadius="4" Padding="4">`,
    ...content, `${indent}</Border>`].join('\n');
}

/**
 * A check box or a radio button with no words, and the words drawn beside it,
 * as one control: that is how both HTML and WPF write it, and a check box
 * whose label is a separate text cannot be ticked by pressing the label.
 */
function paired(children: readonly Control[]): Control[] {
  const out: Control[] = [];
  for (let n = 0; n < children.length; n++) {
    const one = children[n]!;
    const next = children[n + 1];
    if ((one.kind === 'check' || one.kind === 'radio') && one.node.text === '' && next?.kind === 'text') {
      out.push({ ...one, node: { ...one.node, text: next.node.text } });
      n++;
      continue;
    }
    out.push(one);
  }
  return out;
}

/** The heading cell of a table column: the shape in it, if any. */
function shapeIn(control: Control, cell: string): Node | undefined {
  return control.children.find(child => child.node.id === cell)?.node;
}

/** The screen as a WPF window in XAML: the controls in Grid, StackPanel and, where nothing arranged them, Canvas. */
export function screenToXaml(file: DiagramFile, options: { title?: string; className?: string; locale?: Locale } = {}): string {
  const { roots, width, height } = controlsOf(file, options.locale ?? DEFAULT_LOCALE);
  const content = roots.length === 1
    ? xamlOf(roots[0]!, '', '  ')
    : [`  <Canvas Width="${round(width)}" Height="${round(height)}">`,
      ...roots.map(root => xamlOf(root, root.box ? `Canvas.Left="${round(root.box.x)}" Canvas.Top="${round(root.box.y)}"` : '', '    ')),
      '  </Canvas>'].join('\n');
  const name = options.className ?? 'App.MainWindow';
  return `<Window x:Class="${escapeXml(name)}"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="${escapeXml(options.title ?? '')}" Width="${round(width) + 40}" Height="${round(height) + 60}"
        SizeToContent="WidthAndHeight">
${content}
</Window>
`;
}
