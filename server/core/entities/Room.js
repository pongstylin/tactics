const state = require('../state');

module.exports = class Room {
  constructor (id) {
    this.id = id;
    this.listeners = {};
  }

  addListener(guid, callback) {
    if (this.listeners.hasOwnProperty(guid)) {
      throw new Error('Listener already registered for ' + guid);
    }
    this.listeners[guid] = callback;
  }

  removeListener(guid) {
    delete this.listeners[guid];
  }

  get size() {
    return Object.keys(this.listeners).length;
  }

  broadcast(event, data) {
    Object.values(this.listeners).forEach(callback => {
      callback(event, data);
    });
  }
};
