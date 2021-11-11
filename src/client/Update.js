import Version from 'models/Version.js';
import whenDOMReady from 'components/whenDOMReady.js';
import UpdateProgress from 'components/Modal/UpdateProgress.js';
import popup from 'components/popup.js';

export const getWorkerVersion = async (worker = navigator.serviceWorker.controller) => {
  if (!worker) return null;
  const sw = navigator.serviceWorker;

  return new Promise(resolve => {
    const listener = ({ data:message }) => {
      if (message.type !== 'version') return;

      sw.removeEventListener('message', listener);
      resolve(new Version(message.data.version));
    };

    sw.addEventListener('message', listener);
    worker.postMessage({ type:'version' });
  });
};
export const skipWaiting = async (worker) => {
  if (!worker) return null;

  worker.postMessage({ type:'skipWaiting' });
};

export const installUpdate = async version => {
  try {
    await whenDOMReady;

    const sw = navigator.serviceWorker;
    if (!sw)
      return refresh();

    const reg = await sw.getRegistration();

    new UpdateProgress({ reg, version });
  } catch (error) {
    fail();
    reportError(error);
  }
};

/*
 * Poor man's update activation for clients that do not support service workers.
 */
const refresh = () => popup({
  message: 'A new update is available.',
  buttons: [
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
});
