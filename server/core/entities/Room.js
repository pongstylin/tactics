const state = require('../state');

module.exports = class Room {
  constructor (id) {
    this.id = id;
    this.listeners = {};
  }

  addOccupent(guid, name, callback) {
    if (this.listeners.hasOwnProperty(guid)) {
      throw new Error('Listener already registered for ' + guid);
    }
    this.listeners[guid] = { name, callback };
  }

  removeOccupent(guid) {
    delete this.listeners[guid];
  }

  get size() {
    return Object.keys(this.listeners).length;
  }

  get occupantList() {
    return Object.values(this.listeners).reduce((arr, { name }) => {
      arr.push(name);
      return arr;
    }, []);
  }

  broadcast(event, data) {
    Object.values(this.listeners).forEach(({ callback }) => {
      callback(event, data);
    });
  }
};
