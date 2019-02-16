const models = require('../../db/models/index');

module.exports = async socket => {
  console.info('[info] createGame');

  if (!socket.state.player) {
    return;
  }

  const game = await models.game.create({playerOneId: socket.state.player.id});
  socket.emit('createGame.succeeded', game.id);
  socket.joinRoom(game.id);
};
