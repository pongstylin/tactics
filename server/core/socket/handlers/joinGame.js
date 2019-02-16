const config = require('../../../config');
const models = require('../../db/models/index');
const state = require('../../state');
const validator = require('../../../../shared/validator/index');

module.exports = async (socket, data) => {
  console.info('[info] joinGame', data);

  if (!validator.validate(data,  config.shared.validators.joinGame(data)).passed) {
    console.info('[info] invalid data');
    return;
  }

  if (!socket.state.player) {
    return;
  }

  const { gameId } = data;

  let game;
  try {
    game = await models.game.findOne({ where: { id: gameId }, });
  } catch (err) {
    console.error('[error]', err);
    socket.emit('joinGame.failed', ['Error while finding game']);
  }

  if (!game) {
    socket.emit('joinGame.failed', ['Game not found']);
    return
  }

  if (game.playerOneId === socket.state.player.id || game.playerTwoId === socket.state.player.id) {
    socket.emit('joinGame.succeeded', game.id);
    socket.joinRoom(game.id)
  } else if (game.playerTwoId === null) {
    await game.setPlayerTwo(socket.state.player);
    socket.emit('joinGame.succeeded', game.id);
    socket.joinRoom(game.id)
  } else {
    console.error('[error] Game is full');
    socket.emit('joinGame.failed', ['Game is full']);
  }
};
