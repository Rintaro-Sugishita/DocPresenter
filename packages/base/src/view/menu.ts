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
  readonly run: () => void;
  /** A rule above this item, to group what belongs together. */
  readonly separated?: boolean;
  /**
   * The heading this item sits under.
   *
   * A list of a dozen is read; a list of fifty is searched. Headings turn the
   * second back into the first — the reader goes to the heading they want and
   * reads the handful under it. Consecutive items naming the same heading share
   * one, so the caller only has to keep them together.
   */
  readonly group?: string;
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
  const root = owner.createElement('div');
  root.className = 'dp-menu';
  root.setAttribute('role', 'menu');
  root.hidden = true;
  owner.body.append(root);

  const close = (): void => {
    root.hidden = true;
    root.replaceChildren();
  };

  // A press anywhere else closes it, and does nothing more: acting on what is
  // beneath as well would mean a stray right-click changed the selection.
  owner.addEventListener('mousedown', event => {
    if (root.hidden) return;
    if (root.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, true);
  owner.addEventListener('keydown', event => {
    if (!root.hidden && event.key === 'Escape') { event.preventDefault(); close(); }
  });
  owner.defaultView?.addEventListener('resize', close);

  return {
    get isOpen() { return !root.hidden; },
    close,
    open(x, y, items) {
      root.replaceChildren();
      let heading: string | undefined;
      for (const item of items) {
        if (item.group !== undefined && item.group !== heading) {
          root.append(groupLabel(owner, item.group));
          heading = item.group;
        }
        if (item.separated) root.append(rule(owner));
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
        button.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
          close();
          item.run();
        });
        root.append(button);
      }
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

function groupLabel(owner: Document, text: string): HTMLElement {
  const label = owner.createElement('div');
  label.className = 'dp-menu-group';
  label.textContent = text;
  return label;
}

function rule(owner: Document): HTMLElement {
  const line = owner.createElement('div');
  line.className = 'dp-menu-rule';
  return line;
}
