const state = require('../state');
const Socket = require('../entities/Socket');
const {guid} = require('../../../shared/util');

const logConnectedClients = () => {
  console.info(`[info] ${Object.keys(state.sockets).length} clients connected`);
};

module.exports = socket => {
  socket.guid = guid();
  state.sockets[socket.guid] = new Socket(socket);

  console.info('[info] connection opened');
  logConnectedClients();

  socket.send(JSON.stringify({event: 'connected', data: null}));

  // Handle client messages
  socket.on('message', message => {
    console.info('[info] connection message');

    try {
      const {event, data} = JSON.parse(message);
      if (state.sockets.hasOwnProperty(socket.guid)) {
        state.sockets[socket.guid].handleEvent(event, data);
      }
    } catch (err) {
      // Ignore malformed client messages
      console.error('[error] Malformed client message:', message);
    }
  });

  // Handle client disconnections
  socket.on('close', () => {
    console.info('[info] connection closed');
    delete state.sockets[socket.guid];
    logConnectedClients();
  });
};
