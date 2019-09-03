'use strict';

if ('serviceWorker' in navigator) {
  let sw = navigator.serviceWorker;

  /*
  function getAppVersion() {
    sw.getRegistration()
      .then(reg => reg.active.postMessage({type:'getVersion'}));
  }

  let version = 0;
  sw.addEventListener('message', event => {
    let message = event.data;

    version++;
    if (message.type === 'version')
      notify('version-'+version, 'Has version: '+(message.version || 'Latest'));

    console.log('message', message);
  });
  */

  window.addEventListener('load', event => {
    sw.register('/sw.js').then(reg => {
      if (reg.active)
        sw.addEventListener('controllerchange', event => {
          notify('update', 'A new update is available.  <A href="javascript:location.reload()">Reload</A>');
        });

      /*
       * If no update was found automatically within 30 seconds, manually check.
       */
      if (!reg.installing) {
        // The manual update returns a promise that is rejected if the update
        // failed due to lack of connectivity.  Ignore the rejection.
        let checkUpdate = setTimeout(() => reg.update().catch(() => {}), 30000);
        reg.addEventListener('updatefound', () => clearTimeout(checkUpdate));
      }

      /*
      let state = 0;

      if (reg.installing)
        notify('installing', 'A worker is already installing');
      else if (reg.waiting)
        notify('waiting', 'A working is already waiting');
      else {
        notify('doupdate', 'An update is requested');
        reg.update().then(() => {
          notify('gotupdate', 'Found update: '+!!reg.installing);
        });
      }

      if (reg.active) {
        let activeWorker = reg.active;
        notify('active', 'A worker is already active');
        activeWorker.postMessage({type:'getVersion'});
        activeWorker.addEventListener('statechange', () => {
          state++;
          notify('state-'+state, 'Active worker state: '+activeWorker.state);
        });
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.postMessage({type:'getVersion'});

        state++;
        notify('state-'+state, 'New worker state: '+newWorker.state);

        newWorker.addEventListener('statechange', () => {
          state++;
          notify('state-'+state, 'New worker state: '+newWorker.state);

          if (newWorker.state === 'installed')
            notify('update', 'A new update has been installed.  <A href="javascript:location.reload()">Reload</A>');
        });
      });
      */
    });
  });
}

function notify(name, msg) {
  let $notification = $('#notifications .'+name);

  if ($notification.length)
    $notification.remove();

  $notification = $('<DIV>')
    .addClass(name)
    .append(msg)
    .append('<SPAN class="close">X</SPAN>')
    .one('click', () => $notification.fadeOut(() => $notification.remove()))
    .hide()
    .appendTo('#notifications')
    .fadeIn();
}
