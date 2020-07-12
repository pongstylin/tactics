import NoSleep from 'nosleep.js';

const noSleep = new NoSleep();
const KEEP_AWAKE = 15 * 60 * 1000;

let timeout = null;

export default {
  enabled: false,

  toggle(toggle = !this.enabled) {
    if (toggle)
      this.enable();
    else
      this.disable();
  },

  enable() {
    if (this.enabled) return this.stayAwake();

    timeout = setTimeout(() => this.disable(), KEEP_AWAKE);
    noSleep.enable();
    this.enabled = true;
  },

  disable() {
    if (!this.enabled) return;

    clearTimeout(timeout);
    timeout = null;
    noSleep.disable();
    this.enabled = false;
  },

  stayAwake() {
    if (!this.enabled) return;

    clearTimeout(timeout);
    timeout = setTimeout(() => this.disable(), KEEP_AWAKE);
  },
};
