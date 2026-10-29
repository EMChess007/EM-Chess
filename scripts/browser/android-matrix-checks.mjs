/**
 * The in-page checks of the Android device matrix. `pageChecks` runs INSIDE the browser (it is serialised with `.toString()` and evaluated in the page), so it uses no import and no
 * outer variable: everything it needs arrives in `opts`. It returns a list of issues; an empty list is a pass. The runner proves these checks catch what they claim to
 * (android-matrix.mjs --self-test renders a fixture with every defect on purpose).
 *
 * What counts as a defect (the user's pass criteria):
 *   clip         a piece of text whose box is cut: its own box scrolls (scrollWidth > clientWidth or scrollHeight > clientHeight, which includes an ellipsis and a line clamp), or an
 *                ancestor that hides its overflow cuts the text's rectangle, or the text lies outside the window sideways (outside a horizontally scrollable area);
 *   page-scroll  the page scrolls sideways;
 *   offscreen    a control that cannot be reached: outside the window sideways, or below the window with no scrollable area that could bring it into view;
 *   overlap      two controls overlap, or two pieces of text overlap (neither contains the other);
 *   target       a control smaller than 44 dp on a side (board squares are exempt: they answer to the board's own minimum cell);
 *   board-cell   a board cell smaller than the board's minimum (the size gate / scrolling must have applied);
 *   inset        text or a control inside a system bar / display cutout (the insets are emulated with CDP, see android-matrix-def.mjs).
 */
export function pageChecks(opts) {
  const { insets, minTarget, clipTolerance, minBoardCell, boardKind, exempt } = opts;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const issues = [];
  const seen = new Set();
  const add = (kind, el, detail) => {
    const key = kind + '|' + describe(el) + '|' + detail;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ kind, el: describe(el), detail });
  };

  function describe(el) {
    if (!el || !el.tagName) return '?';
    const id = el.getAttribute('data-testid');
    const label = el.getAttribute('aria-label');
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return el.tagName.toLowerCase() + (id ? '#' + id : '') + (label ? '[' + label.slice(0, 30) + ']' : '') + (text ? ' "' + text + '"' : '');
  }
  const isHidden = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
    }
    return false;
  };
  const clips = (cs, axis) => ['hidden', 'clip'].includes(axis === 'x' ? cs.overflowX : cs.overflowY);
  const scrolls = (cs, axis) => ['auto', 'scroll'].includes(axis === 'x' ? cs.overflowX : cs.overflowY);
  /** The nearest ancestor that scrolls sideways (a horizontal ScrollView): what sits inside it is allowed to extend past the window. */
  const hScroller = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (scrolls(cs, 'x') && n.scrollWidth > n.clientWidth + 1) return n;
    }
    return null;
  };
  const vScroller = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (scrolls(cs, 'y') && n.scrollHeight > n.clientHeight + 1) return n;
    }
    return null;
  };
  // A board square answers to the board's own minimum cell (below), not to the 44 dp target rule.
  const squareLabel = /^[a-n](1[0-4]|[1-9])(,|$)/;
  /** Under a modal or another layer: its centre point belongs to an unrelated element. Such an element is not on screen for the person, so it is not judged here. */
  // A window-sized layer that dims what is under it (a dialog's overlay, the Bughouse size gate's "rotate the device" overlay: positioned, covering the window, a background at least 40 % opaque)
  // hides everything outside it, including what lies beyond the window's edge. react-native-web does not render accessibilityViewIsModal as aria-modal, so the layer is found by what it is.
  const alphaOf = (color) => {
    const m = /^rgba?\(([^)]*)\)$/.exec(color);
    if (!m) return 0;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean);
    return parts.length >= 4 ? Number(parts[3]) : 1;
  };
  // The LAST such element in document order: layers are drawn after the content they cover (an app root that is itself positioned and opaque comes first and is not the layer).
  const blockingLayer = Array.from(document.querySelectorAll('div,[aria-modal="true"]'))
    .filter((m) => {
      const cs = getComputedStyle(m);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      const mr = m.getBoundingClientRect();
      if (mr.width * mr.height < vw * vh * 0.85) return false; // a layer inside the root frame stops above the bottom / side insets
      return m.getAttribute('aria-modal') === 'true' || alphaOf(cs.backgroundColor) >= 0.4;
    })
    .pop();
  const covered = (el, r) => {
    if (blockingLayer && !blockingLayer.contains(el) && !el.contains(blockingLayer)) return true;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) return false;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || el.contains(hit) || hit.contains(el)) return false;
    // A layer (modal, backdrop, sheet): a positioned ancestor of what is on top that spans most of the window and contains this element. A sibling control that merely overlaps is NOT a layer.
    for (let n = hit; n && n !== document.body; n = n.parentElement) {
      if (n.contains(el)) return false;
      const position = getComputedStyle(n).position;
      if (position !== 'fixed' && position !== 'absolute') continue;
      const nr = n.getBoundingClientRect();
      // Compared with the part of the element that is in the window: a text that runs past the window's edge is still under the layer where it can be seen.
      const seen = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, vw), bottom: Math.min(r.bottom, vh) };
      if (nr.width * nr.height >= vw * vh * 0.6 && nr.left <= seen.left + 1 && nr.top <= seen.top + 1 && nr.right >= seen.right - 1 && nr.bottom >= seen.bottom - 1) return true;
    }
    return false;
  };
  /** The board cell (an element labelled with a square name) that contains `el`, or null. */
  const cellOfEl = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) if (squareLabel.test(n.getAttribute('aria-label') || '')) return n;
    return null;
  };
  const isExempt = (el) => squareLabel.test(el.getAttribute('aria-label') || '') || exempt.some((selector) => el.closest(selector));

  // ---- text ---------------------------------------------------------------------------------------------------------------------------------------
  const textBoxes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || !node.nodeValue.trim()) continue;
    const el = node.parentElement;
    if (!el || isHidden(el) || el.closest('script,style,noscript')) continue;
    // Only the glyphs: the spaces that hang past the end of a wrapped line (white-space: pre-wrap) are not text anyone can lose.
    const range = document.createRange();
    range.setStart(node, node.nodeValue.length - node.nodeValue.trimStart().length);
    range.setEnd(node, node.nodeValue.trimEnd().length);
    let rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length > 1) {
      // A wrapped text: measure word by word, because every wrapped line carries a hanging space whose rectangle reaches past the glyphs.
      const wordRects = [];
      const words = /\S+/g;
      for (let m = words.exec(node.nodeValue); m; m = words.exec(node.nodeValue)) {
        const wordRange = document.createRange();
        wordRange.setStart(node, m.index);
        wordRange.setEnd(node, m.index + m[0].length);
        for (const r of wordRange.getClientRects()) if (r.width > 0 && r.height > 0) wordRects.push(r);
      }
      if (wordRects.length > 0) rects = wordRects;
    }
    if (rects.length === 0) continue;
    const box = {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
    if (covered(el, { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.right - box.left, height: box.bottom - box.top })) continue;
    textBoxes.push({ el, box });

    // 1. its own box
    if (el.scrollWidth > el.clientWidth + clipTolerance && el.clientWidth > 0) add('clip', el, 'scrollWidth ' + el.scrollWidth + ' > clientWidth ' + el.clientWidth);
    if (el.scrollHeight > el.clientHeight + clipTolerance && el.clientHeight > 0) add('clip', el, 'scrollHeight ' + el.scrollHeight + ' > clientHeight ' + el.clientHeight);

    // 2. an ancestor that hides what falls outside it
    // Walking up: once a scroller is passed, what lies beyond it on that axis is reached by scrolling, so ancestors further out cannot cut it.
    let xScrolled = false;
    let yScrolled = false;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ar = a.getBoundingClientRect();
      const bl = parseFloat(cs.borderLeftWidth) || 0;
      const br = parseFloat(cs.borderRightWidth) || 0;
      const bt = parseFloat(cs.borderTopWidth) || 0;
      const bb = parseFloat(cs.borderBottomWidth) || 0;
      const outX = box.left < ar.left + bl - clipTolerance || box.right > ar.right - br + clipTolerance;
      const outY = box.top < ar.top + bt - clipTolerance || box.bottom > ar.bottom - bb + clipTolerance;
      if (!xScrolled && clips(cs, 'x') && outX) add('clip', el, 'cut sideways by ' + describe(a));
      if (!yScrolled && clips(cs, 'y') && outY) add('clip', el, 'cut vertically by ' + describe(a));
      if (scrolls(cs, 'x') && a.scrollWidth > a.clientWidth + 1) xScrolled = true;
      if (scrolls(cs, 'y') && a.scrollHeight > a.clientHeight + 1) yScrolled = true;
      if (!xScrolled && scrolls(cs, 'x') && outX) add('clip', el, 'cut sideways by ' + describe(a));
    }

    // 3. outside the window sideways (a horizontal scroller is allowed to extend)
    if ((box.left < -clipTolerance || box.right > vw + clipTolerance) && !hScroller(el)) add('clip', el, 'outside the window sideways: ' + Math.round(box.left) + '..' + Math.round(box.right) + ' of ' + vw);

    // 4. system bars / cutout
    if (!el.closest('[data-matrix-fullbleed]')) {
      if (box.top < insets.top - clipTolerance && box.top >= -1 && !vScroller(el)) add('inset', el, 'text starts at ' + Math.round(box.top) + ', inside the top inset ' + insets.top);
      if (box.left < insets.left - clipTolerance && box.left >= -1) add('inset', el, 'text starts at ' + Math.round(box.left) + ', inside the left inset ' + insets.left);
      if (box.right > vw - insets.right + clipTolerance && box.right <= vw + 1) add('inset', el, 'text ends at ' + Math.round(box.right) + ', inside the right inset ' + insets.right);
      if (box.bottom > vh - insets.bottom + clipTolerance && box.bottom <= vh + 1 && !vScroller(el)) add('inset', el, 'text ends at ' + Math.round(box.bottom) + ', inside the bottom inset ' + insets.bottom);
    }
  }

  // ---- the page --------------------------------------------------------------------------------------------------------------------------------------
  const scrollingElement = document.scrollingElement || document.documentElement;
  if (scrollingElement.scrollWidth > vw + 1) add('page-scroll', document.body, 'scrollWidth ' + scrollingElement.scrollWidth + ' > window ' + vw);

  // ---- controls -------------------------------------------------------------------------------------------------------------------------------------
  const controlSelector = '[tabindex="0"],[role="button"],[role="link"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],a[href],button,input,textarea,select';
  const controls = Array.from(document.querySelectorAll(controlSelector)).filter((el) => !isHidden(el) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && !covered(el, el.getBoundingClientRect()));
  const boxes = controls.map((el) => ({ el, r: el.getBoundingClientRect() }));
  // A window-sized control is a layer under the other controls (a dismiss backdrop), not a button they overlap.
  const isLayer = (r) => r.width >= vw * 0.9 && r.height >= vh * 0.9;
  for (const { el, r } of boxes) {
    // A control that spans the window (a modal's dimming backdrop that dismisses on tap) is a layer, not a button: no target size, and it is meant to reach under the system bars.
    const exemptEl = isExempt(el) || (r.width >= vw * 0.9 && r.height >= vh * 0.9);
    if (!exemptEl && (r.width < minTarget - 0.5 || r.height < minTarget - 0.5)) add('target', el, Math.round(r.width) + 'x' + Math.round(r.height) + ' dp');
    const hs = hScroller(el);
    if (!hs && (r.left < -clipTolerance || r.right > vw + clipTolerance)) add('offscreen', el, 'sideways ' + Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + vw);
    if (!vScroller(el) && r.bottom > vh + clipTolerance && r.top < vh) add('offscreen', el, 'bottom ' + Math.round(r.bottom) + ' > window ' + vh + ' and nothing scrolls');
    if (!exemptEl && !el.closest('[data-matrix-fullbleed]')) {
      if (r.top < insets.top - clipTolerance && r.bottom > 0 && !vScroller(el)) add('inset', el, 'control starts at ' + Math.round(r.top) + ', inside the top inset ' + insets.top);
      if (r.bottom > vh - insets.bottom + clipTolerance && r.top < vh && !vScroller(el)) add('inset', el, 'control ends at ' + Math.round(r.bottom) + ', inside the bottom inset ' + insets.bottom);
      if (r.left < insets.left - clipTolerance && r.right > 0 && !hs) add('inset', el, 'control starts at ' + Math.round(r.left) + ', inside the left inset ' + insets.left);
      if (r.right > vw - insets.right + clipTolerance && r.left < vw && !hs) add('inset', el, 'control ends at ' + Math.round(r.right) + ', inside the right inset ' + insets.right);
    }
  }
  const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  /** The part of a box that can be seen: cut by every ancestor that clips or scrolls, and by the window. Null when none of it is on screen. */
  const visibleBox = (el, r) => {
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    box = { left: Math.max(box.left, 0), top: Math.max(box.top, 0), right: Math.min(box.right, vw), bottom: Math.min(box.bottom, vh) };
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const cutX = clips(cs, 'x') || scrolls(cs, 'x');
      const cutY = clips(cs, 'y') || scrolls(cs, 'y');
      if (!cutX && !cutY) continue;
      const ar = a.getBoundingClientRect();
      if (cutX) box = { ...box, left: Math.max(box.left, ar.left), right: Math.min(box.right, ar.right) };
      if (cutY) box = { ...box, top: Math.max(box.top, ar.top), bottom: Math.min(box.bottom, ar.bottom) };
    }
    return box.right > box.left && box.bottom > box.top ? box : null;
  };
  const area = (b) => (b.right - b.left) * (b.bottom - b.top);
  const seenBoxes = boxes.map((b) => ({ ...b, v: visibleBox(b.el, b.r) })).filter((b) => b.v);
  for (let i = 0; i < seenBoxes.length; i++) {
    for (let j = i + 1; j < seenBoxes.length; j++) {
      const a = seenBoxes[i];
      const b = seenBoxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (isLayer(a.r) || isLayer(b.r)) continue;
      if (isExempt(a.el) && isExempt(b.el)) continue;
      const shared = overlapArea(a.v, b.v);
      if (shared > 6 && shared > Math.min(area(a.v), area(b.v)) * 0.1) add('overlap', a.el, 'overlaps ' + describe(b.el));
    }
  }
  // text over text (two different elements; a text node inside the other's box is nesting, not an overlap)
  const seenTexts = textBoxes.map((t) => ({ ...t, v: visibleBox(t.el, t.box) })).filter((t) => t.v);
  for (let i = 0; i < seenTexts.length; i++) {
    for (let j = i + 1; j < seenTexts.length; j++) {
      const a = seenTexts[i];
      const b = seenTexts[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // Two marks drawn inside ONE board cell (a piece glyph and the "~" of a promoted piece, a badge) are board art laid over each other on purpose.
      const cellA = cellOfEl(a.el);
      if (cellA && cellA === cellOfEl(b.el)) continue;
      const shared = overlapArea(a.v, b.v);
      if (shared > 8 && shared > Math.min(area(a.v), area(b.v)) * 0.15) add('overlap', a.el, 'text overlaps the text of ' + describe(b.el));
    }
  }

  // ---- the board's cells -----------------------------------------------------------------------------------------------------------------------------
  if (boardKind) {
    const min = minBoardCell[boardKind];
    // A cell inside an exempt container (a read-only thumbnail of the other board) or under a layer (the rotate overlay the size gate puts over the boards) is not a cell a finger can use.
    const cells = Array.from(document.querySelectorAll('[aria-label]')).filter(
      (el) => squareLabel.test(el.getAttribute('aria-label') || '') && !isHidden(el) && !exempt.some((selector) => el.closest(selector)),
    );
    for (const cell of cells.slice(0, 400)) {
      const r = cell.getBoundingClientRect();
      if (r.width > 0 && !covered(cell, r) && Math.min(r.width, r.height) < min - 0.5) add('board-cell', cell, Math.round(r.width) + 'x' + Math.round(r.height) + ' px < ' + min);
    }
  }
  return issues;
}

export const PAGE_CHECKS_SOURCE = pageChecks.toString();
