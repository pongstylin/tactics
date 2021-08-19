/*
 * Same-origin links opening new windows/tabs shouldn't in PWAs.
 */
if (window.matchMedia('(display-mode:standalone)').matches) {
  window.addEventListener('click', event => {
    if (
      event.target.tagName === 'A' &&
      event.target.target === '_blank' &&
      new URL(event.target.href, location.href).origin === location.origin
    ) {
      event.preventDefault();
      window.location.href = event.target.href;
    }
  });
}
