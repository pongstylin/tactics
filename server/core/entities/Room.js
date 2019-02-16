const state = require('../state');

module.exports = class Room {
  constructor (id) {
    this.id = id;
    this.listeners = [];
  }

  addListener(callback) {
    this.listeners.push(callback)
  }

  broadcast(event, data) {
    this.listeners.forEach(cb => cb(event, data));
  }
};
