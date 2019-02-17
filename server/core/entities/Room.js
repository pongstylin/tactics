const state = require('../state');

module.exports = class Room {
  constructor (id) {
    this.id = id;
    this.listeners = {};
  }

  addOccupant(guid, name, callback) {
    if (this.listeners.hasOwnProperty(guid)) {
      throw new Error('Listener already registered for ' + guid);
    }
    this.listeners[guid] = { name, callback };
  }

  removeOccupant(guid) {
    delete this.listeners[guid];
  }

  get size() {
    return Object.keys(this.listeners).length;
  }

  get occupantList() {
    let list = Object.values(this.listeners).reduce((arr, { name }) => {
      arr.push(name);
      return arr;
    }, []);
    list.sort();
    return list;
  }

  broadcast(event, data) {
    Object.values(this.listeners).forEach(({ callback }) => {
      callback(event, data);
    });
  }
};
