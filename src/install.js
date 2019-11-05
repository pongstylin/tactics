import { getWorkerVersion } from 'client/Update.js';

if ('serviceWorker' in navigator) {
  let sw = navigator.serviceWorker;
  if (!sw.controller)
    sw.register('/sw.js');

  if (ENVIRONMENT !== 'production') {
    sw.getRegistration().then(async reg => {
      if (!reg) return;

      sw.addEventListener('controllerchange', async event => {
        let claim = sw.controller;
        console.log('worker claim', claim.state);
        let version = await getWorkerVersion(claim);
        console.log('worker claim', claim.state, version.toString(),
          claim === reg.installing ? 'installing' :
          claim === reg.waiting ? 'waiting' :
          claim === reg.active ? 'active' : 'unknown');
        claim.addEventListener('statechange', event => {
          console.log('worker statechange', 'claim', claim.state, version.toString());
        });
      });

      reg.addEventListener('updatefound', async event => {
        let update = reg.installing;
        console.log('worker update', update.state);
        let version = await getWorkerVersion(update);
        console.log('worker update', update.state, version.toString());
        update.addEventListener('statechange', event => {
          console.log('worker statechange', 'update', update.state, version.toString());
        });
      });

      if (sw.controller) {
        let controller = sw.controller;
        console.log('worker controller', controller.state);
        let version = await getWorkerVersion(controller);
        console.log('worker controller', controller.state, version.toString(),
          controller === reg.installing ? 'installing' :
          controller === reg.waiting ? 'waiting' :
          controller === reg.active ? 'active' : 'unknown');
        controller.addEventListener('statechange', event => {
          console.log('worker statechange', 'controller', controller.state, version.toString());
        });
      }

      if (reg.installing) {
        let installing = reg.installing;
        console.log('worker installing', installing.state);
        let version = await getWorkerVersion(installing);
        console.log('worker installing', installing.state, version.toString());
        installing.addEventListener('statechange', event => {
          console.log('worker statechange', 'installing', installing.state, version.toString());
        });
      }
      if (reg.waiting) {
        let waiting = reg.waiting;
        console.log('worker waiting', waiting.state);
        let version = await getWorkerVersion(waiting);
        console.log('worker waiting', waiting.state, version.toString());
        waiting.addEventListener('statechange', event => {
          console.log('worker statechange', 'waiting', waiting.state, version.toString());
        });
      }
      if (reg.active) {
        let active = reg.active;
        console.log('worker active', active.state);
        let version = await getWorkerVersion(active);
        console.log('worker active', active.state, version.toString());
        active.addEventListener('statechange', event => {
          console.log('worker statechange', 'active', active.state, version.toString());
        });
      }
    });
  }
}
