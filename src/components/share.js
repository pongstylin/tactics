export const share = options => new Promise((resolve, reject) => {
  navigator.share(options).then(resolve).catch(error => {
    // Differentiate between user 'AbortError' and internal errors.
    // E.g. Internal error: could not connect to Web Share interface.
    if (error.message.startsWith('Internal error:'))
      error.isInternalError = true;

    reject(error);
  });

  /*
   * https://bugs.chromium.org/p/chromium/issues/detail?id=636274
   * If the share promise is not resolved or rejected when focus is returned to
   * the window, then reject it after a 100ms delay.
   */
  let cancel = () => setTimeout(() => {
    window.removeEventListener('focus', cancel);

    let error = new Error('Share cancelled');
    error.name = 'ShareTimeout';
    reject(error);
  }, 100);

  window.addEventListener('focus', cancel);
});

export const shareBlob = ({ blob, name, ...options }) => new Promise((resolve, reject) => {
  if (!navigator.share || !navigator.canShare)
    return reject('No Web Share API');
  if (navigator.platform.startsWith('Win'))
    return reject('Decline windows');
  if (blob.type !== 'image/png')
    return reject(new Error('Expected PNG blob type'));

  options.files = [
    new File([ blob ], `${name ?? 'image'}.png`, {
      type: blob.type,
      lastModified: new Date().getTime(),
    }),
  ];

  if (!navigator.canShare(options))
    reject(new Error('Share options unsupported'));

  share(options).then(resolve, reject);
});

export default share;
