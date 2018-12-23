const handlers = require('../socket/handlers');

module.exports = class Socket {
  constructor (socket) {
    this.socket = socket;
  }

  handleEvent(event, data) {
    if (handlers.hasOwnProperty(event)) {
      handlers[event](this, data);
    }
  }

  emit(event, data) {
    this.socket.send(JSON.stringify({event, data}));
  }
}
