const traps = new WeakMap();

const FOCUSABLE_SELECTORS = [
  'A[href]',
  'BUTTON:not([disabled])',
  'TEXTAREA:not([disabled])',
  'INPUT[type="text"]:not([disabled])',
  'INPUT[type="radio"]:not([disabled])',
  'INPUT[type="checkbox"]:not([disabled])',
  'SELECT:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusTargets(element) {
  const targets = [ ...element.querySelectorAll(FOCUSABLE_SELECTORS) ];

  // Filter out visually hidden elements (display:none, visibility:hidden, zero-size, etc.)
  const visible = targets.filter(el => el.offsetParent !== null || el === document.activeElement);

  visible.sort((a, b) => {
    const ta = a.tabIndex;
    const tb = b.tabIndex;
    // tabIndex === 0 means "natural order", sort those after any explicit positive tabindex
    if (ta === tb) return 0;
    if (ta === 0)  return 1;
    if (tb === 0)  return -1;
    return ta - tb;
  });

  return visible;
}

const trapListener = function (element, e) {
  if (e.key !== 'Tab' && e.keyCode !== 9)
    return;

  const focusTargets = getFocusTargets(element);
  const numFocusTargets = focusTargets.length;

  // Nothing to cycle through — prevent Tab from escaping but don't crash
  if (numFocusTargets === 0) {
    e.preventDefault();
    return;
  }

  const index = focusTargets.indexOf(document.activeElement);

  if (e.shiftKey) {
    // Shift+Tab: move backwards
    e.preventDefault();

    if (index === -1) {
      // Focus is outside the trap (e.g. on the modal container itself);
      // land on the last focusable target
      focusTargets[numFocusTargets - 1].focus();
      return;
    }

    // Cycle backwards, skipping any target that refuses focus
    for (let i = 1; i <= numFocusTargets; i++) {
      const candidate = focusTargets[(index - i + numFocusTargets) % numFocusTargets];
      candidate.focus();
      if (document.activeElement === candidate)
        return;
    }
  } else {
    // Tab: move forwards
    e.preventDefault();

    if (index === -1) {
      // Focus is outside the trap; land on the first focusable target
      focusTargets[0].focus();
      return;
    }

    // Cycle forwards, skipping any target that refuses focus
    for (let i = 1; i <= numFocusTargets; i++) {
      const candidate = focusTargets[(index + i) % numFocusTargets];
      candidate.focus();
      if (document.activeElement === candidate)
        return;
    }
  }
};

/**
 * Trap keyboard Tab navigation inside `element`.
 *
 * Focus targets are re-queried on every keydown so the trap automatically
 * adapts to dynamic content changes (async renders, show/hide toggles, etc.)
 * without needing to be called again.
 *
 * Call again if you need to force a reset (e.g. after a major DOM replacement),
 * but it is generally not required for incremental changes.
 *
 * @param {HTMLElement} element
 */
export default function trapFocus(element) {
  const oldTrap = traps.get(element);
  if (oldTrap)
    element.removeEventListener('keydown', oldTrap);

  const newTrap = trapListener.bind(null, element);
  traps.set(element, newTrap);
  element.addEventListener('keydown', newTrap);
}

/**
 * Remove the focus trap from `element`.
 * Call this when the element is destroyed to avoid a listener leak.
 *
 * @param {HTMLElement} element
 */
export function releaseTrap(element) {
  const trap = traps.get(element);
  if (trap) {
    element.removeEventListener('keydown', trap);
    traps.delete(element);
  }
}