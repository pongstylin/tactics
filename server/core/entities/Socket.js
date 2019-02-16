const handlers = require('../socket/handlers');
const state = require('../state');
const Room = require('./Room');

module.exports = class Socket {
  constructor (socket) {
    this.socket = socket;
    this.guid = socket.guid;
  }

  joinRoom(id) {
    this.state.room = state.rooms[id] = state.rooms[id] || new Room(id);
    this.state.room.addListener((event, data) => this.emit(event, data));
  }

  handleEvent(event, data) {
    if (handlers.hasOwnProperty(event)) {
      handlers[event](this, data);
    }
  }

  get state() {
    return state.sockets[this.guid];
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

  broadcastRoom(event, data) {
    if (this.state.room) {
      this.state.room.broadcast(event, data);
    } else {
      this.emit(event, data);
    }
  }
};
