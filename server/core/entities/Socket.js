const handlers = require('../socket/handlers');
const state = require('../state');

module.exports = class Socket {
  constructor (socket) {
    this.socket = socket;
    this.guid = socket.guid;
  }

  handleEvent(event, data) {
    if (handlers.hasOwnProperty(event)) {
      handlers[event](this, data);
    }
  }

  /**
   * Send message to this socket
   * @param {String} event
   * @param {*} data
   */
  emit(event, data) {
    this.socket.send(JSON.stringify({event, data}));
  }

  /**
   * Send message to all sockets
   * @param {String} event
   * @param {*} data
   */
  broadcast(event, data) {
    for (let socketId in state.sockets) {
      if (state.sockets.hasOwnProperty(socketId)) {
        state.sockets[socketId].socket.send(JSON.stringify({event, data}));
      }
    }
  }
}
