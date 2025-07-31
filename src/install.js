import whenDOMReady from 'components/whenDOMReady.js';
import popup from 'components/popup.js';

if ('serviceWorker' in navigator) {
  let sw = navigator.serviceWorker;
  if (!sw.controller)
    sw.register('/sw.js').catch(async error => {
      if (
        navigator.userAgent.indexOf('Firefox') > -1 &&
        error.message === 'The operation is insecure.'
      ) {
        let isWarned = sessionStorage.getItem('isWarnedInsecure');
        if (!isWarned) {
          await whenDOMReady;
          popup({
            title: 'Warning',
            message: `
              Firefox is configured to clear cookies when it is closed.
              This means your account will be lost every time you close Firefox.
              So you will not be able to complete games-in-progress if you close Firefox.
              Consider disabling this setting.
            `,
            maxWidth: '300px',
          });
          sessionStorage.setItem('isWarnedInsecure', true);
        }
      }
      else {
        console.log('throwing error');
        throw error;
      }
    });
}
