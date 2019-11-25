import Version from 'client/Version.js';
import whenDOMReady from 'components/whenDOMReady.js';
import popup from 'components/popup.js';

export const getWorkerVersion = async (worker = navigator.serviceWorker.controller) => {
  if (!worker) return null;
  let sw = navigator.serviceWorker;

  return new Promise(resolve => {
    let listener = ({ data:message }) => {
      if (message.type !== 'version') return;

      sw.removeEventListener('message', listener);
      resolve(new Version(message.data.version));
    };

    sw.addEventListener('message', listener);
    worker.postMessage({ type:'version' });
  });
}

export const getUpdate = async version => {
  let sw = navigator.serviceWorker;
  if (!sw)
    return popup({
      message: 'A new update is available.  Ignore or activate it.  You may experience issues until the update is activated.',
      buttons: [
        { label:'Ignore' },
        {
          label: 'Activate',
          onClick: () => {
            // Use 'true' to refresh cache.
            setTimeout(() => location.reload(true));
            return new Promise(() => {});
          },
        },
      ],
      closeOnCancel: false,
      zIndex: 999,
    }).whenClosed;

  let reg = await sw.getRegistration();
  let worker = reg.active;
  let newWorker = reg.installing;

  await whenDOMReady;

  if (
    newWorker ||
    !worker ||
    worker.state === 'redundant' ||
    !version.isCompatibleWith(await getWorkerVersion(worker))
  ) {
    let updatePopup = popup({
      message: 'Downloading update...',
      buttons: [],
      closeOnCancel: false,
    });

    try {
      if (!newWorker) {
        await reg.update();

        newWorker = reg.installing;
        if (!newWorker)
          throw new Error('No update was found');
      }

      await untilWorkerReady(newWorker);
      updatePopup.close();
    }
    catch (error) {
      updatePopup.close();
      popup({
        message: 'Downloading a new update failed.  Ignore it or try reloading to resolve the issue.  You may experience issues until the update is activated.',
        buttons: [
          { label:'Ignore' },
          {
            label: 'Reload',
            onClick: () => {
              // Do not use 'true' to avoid bypassing service worker
              setTimeout(() => location.reload());
              return new Promise(() => {});
            },
          },
        ],
        minWidth: '310px',
        zIndex: 999,
      });
      throw error;
    }
  }

  return popup({
    message: 'Downloaded new update.  Ignore or activate it.  You may experience issues until the update is activated.',
    buttons: [
      { label:'Ignore' },
      {
        label: 'Activate',
        onClick: () => {
          // Do not use 'true' to avoid bypassing service worker
          setTimeout(() => location.reload());
          return new Promise(() => {});
        },
      },
    ],
    closeOnCancel: false,
    zIndex: 999,
  }).whenClosed;
};

const untilWorkerReady = worker => new Promise((resolve, reject) => {
  if (worker.state !== 'installing')
    return resolve(worker.state);

  let listener = event => {
    worker.removeEventListener('statechange', listener);
    if (worker.state === 'redundant')
      reject(new Error(worker.state));
    else
      resolve(new Error(worker.state));
  };

  worker.addEventListener('statechange', listener);
});
