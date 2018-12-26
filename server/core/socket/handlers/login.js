const bcrypt = require('bcrypt');
const JWT = require('jsonwebtoken');
const state = require('../../state');
const config = require('../../../config');
const validator = require('../../../../shared/validator/index');
const models = require('../../db/models/index');

module.exports = async (socket, data) => {
  console.info('[info] login', data);

  const validation = validator.validate(data, config.shared.validators.login(data));

  if (!validation.passed) {
    socket.emit('auth.failed', validation.getErrors());
    return;
  }

  try {
    const player = await models.player.findOne({where: {username: data.username}});

    if (!player) {
      socket.emit('auth.failed', ['Invalid login details']);
      return;
    }

    if (!await bcrypt.compare(data.password, player.password)) {
      socket.emit('auth.failed', ['Invalid login details']);
      return;
    }

    const playerJSON = player.toJSON();

    playerJSON.token = JWT.sign({player: playerJSON}, config.key);
    state.sockets[socket.guid].token = playerJSON.token;

    socket.emit('auth.succeeded', playerJSON);
  } catch (err) {
    console.error('[error]', err);
    socket.emit('auth.failed', ['Invalid login details']);
  }
};
