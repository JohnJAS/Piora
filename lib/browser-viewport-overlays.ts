import type { BrowserViewportBounds } from "./browser-viewport-sync";

const MODAL_SELECTOR = '[aria-modal="true"], dialog:modal';
const OVERLAY_SELECTOR = 'dialog, [aria-modal="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [popover]';

export function browserViewportCovered(document: Document, bounds: BrowserViewportBounds): boolean {
  for (const overlay of document.querySelectorAll(OVERLAY_SELECTOR)) {
    if (overlay.matches("dialog:not([open]), [popover]:not(:popover-open)")) continue;
    const rect = overlay.getBoundingClientRect();
    const visibility = document.defaultView?.getComputedStyle(overlay).visibility;
    if (rect.width === 0 || rect.height === 0 || visibility === "hidden" || visibility === "collapse") continue;
    // A modal needs the backdrop over the browser too. Menus and non-modal
    // dialogs only need the native view hidden when they intersect it.
    if (overlay.matches(MODAL_SELECTOR)
      || (rect.left < bounds.x + bounds.width && rect.right > bounds.x
        && rect.top < bounds.y + bounds.height && rect.bottom > bounds.y)) return true;
  }
  return false;
}

function containsOverlay(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return node.matches(OVERLAY_SELECTOR) || node.querySelector(OVERLAY_SELECTOR) !== null;
}

export function observeBrowserViewportOverlays(document: Document, onChange: () => void): () => void {
  const observer = new MutationObserver((records) => {
    const relevant = records.some(({ type, target, attributeName, addedNodes, removedNodes }) => {
      if (target instanceof Element && target.closest(OVERLAY_SELECTOR)) return true;
      if (type === "attributes") {
        return attributeName === "role" || attributeName === "aria-modal" || attributeName === "popover"
          || containsOverlay(target);
      }
      return [...addedNodes, ...removedNodes].some(containsOverlay);
    });
    if (relevant) onChange();
  });
  observer.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["role", "aria-modal", "popover", "open", "hidden", "style", "class"],
  });

  let listening = true;
  const beforeToggle = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.matches("dialog, [popover]")) return;
    // The top-layer state changes after beforetoggle without a DOM mutation.
    queueMicrotask(() => { if (listening) onChange(); });
  };
  document.addEventListener("beforetoggle", beforeToggle, true);
  return () => {
    listening = false;
    observer.disconnect();
    document.removeEventListener("beforetoggle", beforeToggle, true);
  };
}
