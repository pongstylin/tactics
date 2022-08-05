export default (element, trigger) => new Promise((resolve, reject) => {
  let running = false;
  const listener = event => {
    if (event.type === 'transitionrun') {
      running = true;
    } else if (event.type === 'transitionend') {
      detach();
      resolve(event);
    } else if (event.type === 'transitioncancel') {
      detach();
      resolve(event);
    }
  };
  const attach = () => {
    element.addEventListener('transitionrun', listener);
    element.addEventListener('transitionend', listener);
    element.addEventListener('transitioncancel', listener);
  };
  const detach = () => {
    element.removeEventListener('transitionrun', listener);
    element.removeEventListener('transitionend', listener);
    element.removeEventListener('transitioncancel', listener);
  };

  attach();

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (trigger) trigger();

    /*
     * If the transition isn't running after DOM reflow, then bail.
     */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (running) return;

      detach();
      resolve();
    }));
  }));
});
