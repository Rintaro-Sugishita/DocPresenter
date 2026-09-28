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
      for (const item of items) {
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
      root.style.top = `${Math.max(4, Math.min(y, height - box.height - 4))}px`;
      (root.firstElementChild as HTMLElement | null)?.focus();
    },
  };
}

function rule(owner: Document): HTMLElement {
  const line = owner.createElement('div');
  line.className = 'dp-menu-rule';
  return line;
}
