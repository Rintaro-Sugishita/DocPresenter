// A context menu, for the operations that are used occasionally and would
// otherwise fill the toolbar. Rows and columns are the clear case: six buttons
// for inserting and deleting crowd out the things that are used constantly.

export interface MenuItem {
  readonly label: string;
  /**
   * A small picture of what the item does, as inline SVG. Written by the
   * editor, never by a file: "四角" and "角丸" read alike in a list, and a
   * shape is a thing you recognise by looking at it.
   */
  readonly icon?: string;
  /** What choosing it does. An item that only opens a submenu does nothing. */
  readonly run?: () => void;
  /** A rule above this item, to group what belongs together. */
  readonly separated?: boolean;
  /**
   * The items under this one, offered as a submenu.
   *
   * A list of a dozen is read; a list of fifty is a list nobody reads, and
   * cutting it into labelled runs does not help — the runs are still all on the
   * one list, so the reader still goes past every one of them. A submenu is
   * what shortens the list: the top level becomes as short as the number of
   * kinds, and only the kind that was chosen is ever shown.
   */
  readonly items?: readonly MenuItem[];
  readonly disabled?: boolean;
}

export interface Menu {
  /** Opens at a point in the viewport. */
  open(x: number, y: number, items: readonly MenuItem[]): void;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * One menu per document. The grid is rebuilt after every edit, and a menu
 * created with each of them would leave a hidden element and a document-wide
 * listener behind every time.
 */
const menus = new WeakMap<Document, Menu>();

export function createMenu(owner: Document): Menu {
  const existing = menus.get(owner);
  if (existing) return existing;
  const menu = buildMenu(owner);
  menus.set(owner, menu);
  return menu;
}

function buildMenu(owner: Document): Menu {
  const root = panelOf(owner);
  root.hidden = true;
  owner.body.append(root);

  // The submenus standing open, outermost first, each with the row it came
  // from. Only one branch is ever open, so this is a stack and not a tree.
  const branch: { readonly node: HTMLElement; readonly from: HTMLElement }[] = [];
  /** How to open a row's own list, for the keyboard as well as the mouse. */
  const opener = new WeakMap<HTMLElement, () => void>();
  // A pointer on its way to a submenu travels diagonally and crosses the rows
  // beside it. Acting the instant one is touched would snatch the list away
  // mid-journey, so while a branch is open the next move waits a moment. With
  // nothing open there is nothing to lose, and it opens at once.
  const PAUSE = 220;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  const settle = (): void => {
    if (waiting === undefined) return;
    clearTimeout(waiting);
    waiting = undefined;
  };
  const onceSettled = (depth: number, act: () => void): void => {
    settle();
    if (branch.length <= depth) act();
    else waiting = setTimeout(() => { waiting = undefined; act(); }, PAUSE);
  };

  /** Shuts the submenus deeper than the given level. */
  const closeFrom = (depth: number): void => {
    while (branch.length > depth) {
      const open = branch.pop();
      if (!open) break;
      open.from.setAttribute('aria-expanded', 'false');
      open.node.remove();
    }
  };

  const close = (): void => {
    settle();
    closeFrom(0);
    root.hidden = true;
    root.replaceChildren();
  };

  const holds = (node: Node): boolean =>
    root.contains(node) || branch.some(open => open.node.contains(node));

  /** Opens one item's own list beside the row it belongs to. */
  const openSub = (
    from: HTMLElement, items: readonly MenuItem[], depth: number,
  ): HTMLElement => {
    const already = branch[depth];
    if (already?.from === from) return already.node;
    closeFrom(depth);
    const node = panelOf(owner);
    node.classList.add('dp-menu-sub');
    owner.body.append(node);
    branch.push({ node, from });
    keys(node);
    from.setAttribute('aria-expanded', 'true');
    fill(node, items, depth + 1);
    place(owner, node, from);
    return node;
  };

  /**
   * Moving about with the keys. Attached once per list, not once per filling:
   * the root list is filled again at every opening, and a listener added with
   * each filling would move the focus once for every opening so far.
   */
  const keys = (into: HTMLElement): void => {
    into.addEventListener('keydown', event => {
      const depth = into === root
        ? 0
        : branch.findIndex(open => open.node === into) + 1;
      const rows = [...into.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const here = rows.indexOf(owner.activeElement as HTMLButtonElement);
      const step = (by: number): void => {
        event.preventDefault();
        rows[here < 0
          ? (by > 0 ? 0 : rows.length - 1)
          : (here + by + rows.length) % rows.length]?.focus();
      };
      if (event.key === 'ArrowDown') step(1);
      else if (event.key === 'ArrowUp') step(-1);
      else if (event.key === 'ArrowRight') {
        const row = rows[here];
        const show = row ? opener.get(row) : undefined;
        if (show) {
          event.preventDefault();
          show();
          branch[depth]?.node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
        }
      } else if (event.key === 'ArrowLeft' && depth > 0) {
        event.preventDefault();
        const from = branch[depth - 1]?.from;
        closeFrom(depth - 1);
        from?.focus();
      }
    });
  };

  const fill = (into: HTMLElement, items: readonly MenuItem[], depth: number): void => {
    for (const item of items) {
      if (item.separated) into.append(rule(owner));
      const button = owner.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      if (item.icon) {
        const picture = owner.createElement('span');
        picture.className = 'dp-menu-icon';
        picture.innerHTML = item.icon;
        button.append(picture);
      }
      button.append(owner.createTextNode(item.label));
      button.disabled = item.disabled ?? false;
      const under = item.items;
      if (under && under.length > 0) {
        button.classList.add('dp-menu-more');
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        // Hovering opens it, as every menu on every desktop does. Pressing it
        // does the same rather than nothing, because a list that only answers
        // to hover is a list a tablet cannot open.
        const show = (): void => { settle(); openSub(button, under, depth); };
        opener.set(button, show);
        button.addEventListener('mouseenter', () => onceSettled(depth, show));
        button.addEventListener('mouseleave', settle);
        button.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
          show();
        });
      } else {
        // Resting on a row of its own closes the branch a neighbour opened.
        button.addEventListener('mouseenter', () => onceSettled(depth, () => closeFrom(depth)));
        button.addEventListener('mouseleave', settle);
        button.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
          close();
          item.run?.();
        });
      }
      into.append(button);
    }
  };

  keys(root);

  // A press anywhere else closes it, and does nothing more: acting on what is
  // beneath as well would mean a stray right-click changed the selection.
  owner.addEventListener('mousedown', event => {
    if (root.hidden) return;
    if (holds(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, true);
  owner.addEventListener('keydown', event => {
    if (root.hidden || event.key !== 'Escape') return;
    event.preventDefault();
    // One step back, not all the way out: a reader who opened the wrong kind
    // wants the list of kinds again, not an empty screen.
    if (branch.length > 0) {
      const from = branch[branch.length - 1]?.from;
      closeFrom(branch.length - 1);
      from?.focus();
    } else close();
  });
  owner.defaultView?.addEventListener('resize', close);

  return {
    get isOpen() { return !root.hidden; },
    close,
    open(x, y, items) {
      settle();
      closeFrom(0);
      root.replaceChildren();
      fill(root, items, 0);
      root.hidden = false;

      // Placed so that it stays on screen even at the bottom right corner.
      const view = owner.defaultView;
      const box = root.getBoundingClientRect();
      const width = view?.innerWidth ?? box.right;
      const height = view?.innerHeight ?? box.bottom;
      root.style.left = `${Math.max(4, Math.min(x, width - box.width - 4))}px`;
      // A long list is taller than the screen, and clamping alone would push
      // its top off the edge. It is pinned to the top and scrolls instead; the
      // style caps the height, so the box measured here is already the capped
      // one.
      root.style.top = box.height + 8 >= height
        ? '4px'
        : `${Math.max(4, Math.min(y, height - box.height - 4))}px`;
      (root.firstElementChild as HTMLElement | null)?.focus();
    },
  };
}

/** A submenu, beside the row it belongs to and never off the screen. */
function place(owner: Document, node: HTMLElement, from: HTMLElement): void {
  const at = from.getBoundingClientRect();
  // Measured against the list it belongs to, not the row: a row is inset by
  // the list's padding, and a submenu starting inside that padding reads as
  // sitting on top of its parent rather than beside it.
  const beside = from.parentElement?.getBoundingClientRect() ?? at;
  const box = node.getBoundingClientRect();
  const view = owner.defaultView;
  const width = view?.innerWidth ?? box.right;
  const height = view?.innerHeight ?? box.bottom;
  // To the right, and to the left when the right has no room — so the last
  // column of the screen opens inwards instead of off the edge.
  const right = beside.right - 2;
  node.style.left = `${Math.max(4, right + box.width + 4 <= width
    ? right
    : beside.left - box.width + 2)}px`;
  // Level with its row, so the eye carries across; dropped only as far as the
  // screen's foot requires.
  node.style.top = box.height + 8 >= height
    ? '4px'
    : `${Math.max(4, Math.min(at.top - 4, height - box.height - 4))}px`;
}

function panelOf(owner: Document): HTMLElement {
  const node = owner.createElement('div');
  node.className = 'dp-menu';
  node.setAttribute('role', 'menu');
  return node;
}

function rule(owner: Document): HTMLElement {
  const line = owner.createElement('div');
  line.className = 'dp-menu-rule';
  return line;
}
