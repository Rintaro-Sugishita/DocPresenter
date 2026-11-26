// Fitting a screenshot with numbered callouts to the width it is shown at.
//
// The callouts are placed in image pixels, so the image used to keep its own
// size and a narrow screen (a phone) had to scroll sideways to see it. Here the
// image may shrink to the page, and the scale it was shrunk by is handed to the
// callouts as `--dp-overlay-scale`: the renderer writes every position as
// image pixels times that scale, so the numbers stay on what they point at
// while keeping their own readable size.
//
// It is screen chrome only. Without it the scale is 1 and the image is not
// allowed to shrink, which is the layout before this existed.

/** The custom property the renderer multiplies image pixels by. */
export const OVERLAY_SCALE = '--dp-overlay-scale';

/** Set on an overlay whose image may shrink, because its scale is kept up to date. */
export const OVERLAY_FIT_CLASS = 'dp-overlay-fit';

const fitted = new WeakSet<HTMLElement>();

/** Fits every overlay under `root`. Calling it again leaves those already fitted alone. */
export function fitOverlays(root: ParentNode): void {
  for (const stage of root.querySelectorAll<HTMLElement>('.dp-overlay')) fitOverlay(stage);
}

/**
 * Lets one overlay's image shrink to the page and keeps the scale on it while
 * the image loads and whenever its width changes (a resize, a rotated phone, a
 * pane opened beside it).
 */
export function fitOverlay(stage: HTMLElement): void {
  if (fitted.has(stage)) return;
  const image = stage.querySelector<HTMLImageElement>(':scope > .dp-overlay-image');
  if (!image) return;
  fitted.add(stage);

  const measure = (): void => {
    const natural = image.naturalWidth;
    // The laid-out width, not the box on screen: a transform around the page
    // (a zoomed preview) scales the callouts together with the image already.
    const shown = Number.parseFloat(stage.ownerDocument.defaultView?.getComputedStyle(image).width ?? '');
    // Not loaded, or not laid out (a hidden sheet): keep the last scale.
    if (!(natural > 0) || !(shown > 0)) return;
    stage.style.setProperty(OVERLAY_SCALE, String(shown / natural));
  };
  image.addEventListener('load', measure);
  stage.classList.add(OVERLAY_FIT_CLASS);
  if (image.complete) measure();
  const Observer = stage.ownerDocument.defaultView?.ResizeObserver;
  if (Observer) new Observer(measure).observe(image);
}

/** The scale an overlay is shown at: screen pixels per image pixel. */
export function overlayScale(stage: HTMLElement): number {
  const scale = Number.parseFloat(stage.style.getPropertyValue(OVERLAY_SCALE));
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
