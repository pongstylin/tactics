import NoSleep from 'nosleep.js';

const noSleep = new NoSleep();

export default {
  enabled: false,

  toggle(toggle = !this.enabled) {
    if (toggle)
      this.enable();
    else
      this.disable();
  },

  enable() {
    if (this.enabled) return;
console.log('enable');

    noSleep.enable();
    this.enabled = true;
  },

  disable() {
    if (!this.enabled) return;
console.log('disable');

    noSleep.disable();
    this.enabled = false;
  },
};
