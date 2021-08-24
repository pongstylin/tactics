import NoSleep from 'nosleep.js';

const noSleep = new NoSleep();
const KEEP_AWAKE = 15 * 60 * 1000;

let timeout = null;

export default {
  toggle(toggle = !noSleep.enabled) {
    if (toggle)
      this.enable();
    else
      this.disable();
  },

  enable() {
    if (noSleep.enabled) return this.stayAwake();

    timeout = setTimeout(() => this.disable(), KEEP_AWAKE);
    noSleep.enable().catch(error => {
      // I can't do anything about this error
      if (error.name === 'NotAllowedError' && error.message === 'Wake Lock permission request denied')
        return;

      throw error;
    });
  },

  disable() {
    if (!noSleep.enabled) return;

    clearTimeout(timeout);
    timeout = null;
    noSleep.disable();
  },

  stayAwake() {
    if (!noSleep.enabled) return;

    clearTimeout(timeout);
    timeout = setTimeout(() => this.disable(), KEEP_AWAKE);
  },
};
