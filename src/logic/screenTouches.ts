// A tiny app-wide "a touch just started somewhere on screen" signal. App.tsx's root view reports
// every touch start here from the responder CAPTURE phase without ever claiming the touch (it
// returns false), so buttons, scroll views and the board itself all keep working exactly as before
// — this only lets a component that cares (ChessBoard's "tap outside to deselect") find out about
// touches that land outside its own bounds, which its own touch handlers can never see.

type Listener = (pageX: number, pageY: number) => void;

const listeners = new Set<Listener>();

export function subscribeToScreenTouches(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyScreenTouch(pageX: number, pageY: number): void {
  listeners.forEach((listener) => listener(pageX, pageY));
}

/** Whether a touch at (pageX, pageY) falls inside the rectangle measured as (x, y, width, height)
 * in the same page coordinate space (what View.measure reports as pageX/pageY). */
export function isTouchInside(
  pageX: number,
  pageY: number,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return pageX >= rect.x && pageX <= rect.x + rect.width && pageY >= rect.y && pageY <= rect.y + rect.height;
}
