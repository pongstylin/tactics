const handlers = require('../socket/handlers');
const state = require('../state');
const Room = require('./Room');

module.exports = class Socket {
  constructor (socket) {
    this.socket = socket;
    this.guid = socket.guid;
  }

  joinRoom(id, occupantName) {
    if (this.room) {
      this.leaveRoom();
    }

    this.room = state.rooms[id] = state.rooms[id] || new Room(id);
    this.room.addOccupant(
      this.guid,
      occupantName,
      (event, data) => this.emit(event, data)
    );
  }

  leaveRoom() {
    if (!this.room) {
      return;
    }

    this.room.removeOccupant(this.guid);
    if (this.room.size === 0) {
      delete state.rooms[this.room.id];
    }
    delete this.room;
  }

  handleEvent(event, data) {
    if (handlers.hasOwnProperty(event)) {
      handlers[event](this, data);
    } else {
      console.error('[error] Unhandled event: ' + event);
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

  broadcastRoom(event, data) {
    if (this.room) {
      this.room.broadcast(event, data);
    } else {
      this.emit(event, data);
    }
  }
};
