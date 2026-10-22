// A long press is a right click.
//
// Every menu on the page — a shape on the canvas, a cell of the grid, a sheet
// tab — opens on `contextmenu`, and a finger has no right button. Android sends
// `contextmenu` on a long press; Safari on an iPad does not, and neither does a
// pen on every Windows tablet. So a long press is turned into the event the
// menus already listen for, once for the whole page, and no menu has to know
// a finger exists.

/** How long a press has to be held, and how far it may wander and still be one. */
export const LONG_PRESS = { ms: 500, slop: 8 } as const;

const installed = new WeakSet<Document>();

/** Makes a long press with a finger or a pen open the menu a right click would. Once per page. */
export function enableLongPress(owner: Document): void {
  if (installed.has(owner)) return;
  installed.add(owner);

  let pending: { timer: ReturnType<typeof setTimeout>; x: number; y: number; id: number } | undefined;
  /** When the last long press opened a menu, so the platform's own does not open a second. */
  let opened = 0;

  const cancel = (): void => {
    if (pending) clearTimeout(pending.timer);
    pending = undefined;
  };

  owner.addEventListener('pointerdown', event => {
    cancel();
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    const target = event.target as Element | null;
    if (!target) return;
    const { clientX: x, clientY: y, pointerId: id } = event;
    pending = {
      x, y, id,
      timer: setTimeout(() => {
        pending = undefined;
        opened = Date.now();
        target.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 0,
        }));
      }, LONG_PRESS.ms),
    };
  }, true);

  owner.addEventListener('pointermove', event => {
    if (!pending || event.pointerId !== pending.id) return;
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > LONG_PRESS.slop) cancel();
  }, true);
  owner.addEventListener('pointerup', cancel, true);
  owner.addEventListener('pointercancel', cancel, true);

  // The platform's own long-press menu, where there is one: if ours is about to
  // open, the platform's is the one that goes; if ours just opened, its twin
  // is swallowed before any menu sees it.
  owner.addEventListener('contextmenu', event => {
    if (!event.isTrusted) return;
    if (pending) { cancel(); return; }
    if (Date.now() - opened < 1000) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}
