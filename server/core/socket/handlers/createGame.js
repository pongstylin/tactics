const models = require('../../db/models/index');

module.exports = async socket => {
  console.info('[info] createGame');

  if (!socket.player) {
    return;
  }

  const game = await models.game.create({playerOneId: socket.player.id});
  socket.emit('createGame.succeeded', game.id);
  socket.joinRoom(game.id, socket.player.username);
  socket.broadcastRoom('roomOccupantsChanged', { occupants: socket.room.occupantList });
};
