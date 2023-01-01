/*
 * Prevent default touchstart behavior for touch pointers.
 * Example: Prevent highlighting text on a long press on iOS.
 */
const tappable = new WeakMap();

const register = element => {
  tappable.set(element, { pointers:new Map() });

  element.addEventListener('touchstart', onTouchStart, { passive:false });
  element.addEventListener('pointerdown', onPointerDown, { passive:true });
  element.addEventListener('pointerup', onPointerUp, { passive:true });
};
const onTouchStart = event => {
  event.preventDefault();
};
const onPointerDown = event => {
  const target = event.currentTarget;
  const state = tappable.get(target);

  const cancelled = !target.dispatchEvent(new CustomEvent('press', {
    bubbles: true,
    cancelable: true,
  }));
  if (!cancelled) {
    target.setPointerCapture(event.pointerId);

    state.pointers.set(event.pointerId, {
      created_at: new Date(),
      events: [ event ],
    });
  }
};
const onPointerUp = event => {
  const target = event.currentTarget;
  const state = tappable.get(target);
  const pointer = state.pointers.get(event.pointerId);
  if (!pointer)
    return;

  state.pointers.delete(event.pointerId);
  pointer.events.push(event);

  const detail = { pointer };
  detail.duration = new Date() - pointer.created_at;
  detail.outside = (
    event.offsetX < 0 || event.offsetX > target.offsetWidth ||
    event.offsetY < 0 || event.offsetY > target.offsetHeight
  );

  const cancelled = !target.dispatchEvent(new CustomEvent('release', {
    detail,
    bubbles: true,
    cancelable: true,
  }));
  if (cancelled)
    return;

  target.dispatchEvent(new CustomEvent('tap', {
    detail,
    bubbles: true,
    cancelable: false,
  }));

  if (event.pointerType === 'touch')
    target.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
};
const isIterable = val => {
  if (val === null || val === undefined)
    return false

  return typeof val[Symbol.iterator] === 'function';
};

export default (context, selector = null) => {
  let roots;
  if (typeof context === 'string')
    roots = document.querySelectorAll(context);
  else if (isIterable(context))
    roots = context;
  else
    roots = [ context ];

  if (selector === null)
    roots.forEach(register);
  else
    roots.forEach(e => e.querySelectorAll(selector).forEach(register));
};
