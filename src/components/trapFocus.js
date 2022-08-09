const traps = new WeakMap();
const KEYCODE_TAB = 9;

const trapListener = function (focusTargets, e) {
  const isTabPressed = (e.key === 'Tab' || e.keyCode === KEYCODE_TAB);
  if (!isTabPressed)
    return;

  e.preventDefault();

  const numFocusTargets = focusTargets.length;
  let index = focusTargets.indexOf(document.activeElement);

  if (e.shiftKey) {
    if (index === -1) {
      const lastFocusTarget = focusTargets[numFocusTargets - 1];
      if (lastFocusTarget.disabled === true)
        index = numFocusTargets - 1;
      else
        return lastFocusTarget.focus();
    }

    for (let i = index - 1; i !== index; i--) {
      if (i === -1)
        i = numFocusTargets - 1;

      const target = focusTargets[i];
      target.focus();
      if (document.activeElement === target)
        break;
    }
  } else {
    if (index === -1) {
      const firstFocusTarget = focusTargets[0];
      if (firstFocusTarget.disabled === true)
        index = 0;
      else
        return firstFocusTarget.focus();
    }

    for (let i = index + 1; i !== index; i++) {
      if (i === numFocusTargets)
        i = 0;

      const target = focusTargets[i];
      target.focus();
      if (document.activeElement === target)
        break;
    }
  }
};

/*
 * If element content materially changes, call this function again
 */
export default function trapFocus(element) {
  const focusTargets = [ ...element.querySelectorAll([
    'A[href]',
    'BUTTON',
    'TEXTAREA',
    'INPUT[type="text"]',
    'INPUT[type="radio"]',
    'INPUT[type="checkbox"]',
    'SELECT',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')) ];

  focusTargets.sort((a,b) => {
    if (a.tabIndex === b.tabIndex)
      return 0;
    else if (a.tabIndex === 0)
      return 1;
    else if (b.tabIndex === 0)
      return -1;
    else
      return a.tabIndex - b.tabIndex;
  });

  const oldTrap = traps.get(element);
  if (oldTrap)
    element.removeEventListener('keydown', oldTrap);

  const newTrap = trapListener.bind(this, focusTargets);
  traps.set(element, newTrap);
  element.addEventListener('keydown', newTrap);
}
