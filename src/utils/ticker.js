import emitter from '#utils/emitter.js';

class Ticker {
  constructor() {
    this.interval = null;
    this.previous = null;
  }

  start() {
    this.interval = setInterval(this.tick.bind(this), 1000);
    this.previous = performance.now();
  }
  stop() {
    clearInterval(this.interval);
    this.interval = null;
    this.previous = null;
  }
  tick() {
    const pnow = performance.now();
    const elapsed = pnow - this.previous;
    this.previous = pnow;

    // Only enabled in development environments when looking for GC related bugs
    if (global.gc) global.gc();

    this._emit({ type:'tick', now:new Date(), elapsed });
  }
}

emitter(Ticker);

export default new Ticker();