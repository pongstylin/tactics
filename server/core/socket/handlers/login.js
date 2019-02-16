const bcrypt = require('bcrypt');
const JWT = require('jsonwebtoken');
const state = require('../../state');
const config = require('../../../config');
const validator = require('../../../../shared/validator/index');
const models = require('../../db/models/index');

const loginNormal = async (socket, data) => {
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
    socket.state.token = playerJSON.token;
    socket.state.player = player;

    socket.emit('auth.succeeded', playerJSON);
  } catch (err) {
    console.error('[error]', err);
    socket.emit('auth.failed', ['Invalid login details']);
  }
};

const loginJWT =  async (socket, data) => {
  console.info('[info] loginJWT', data);

  try {
    const { token } = data;
    const decoded = JWT.verify(token, config.key);
    const username = decoded.player.username;
    const player = await models.player.findOne({where: { username: username }});

    if (!player) {
      socket.emit('auth.failed', ['Player not found']);
      return;
    }

    const playerJSON = player.toJSON();
    playerJSON.token = token;
    socket.state.token = token;
    socket.state.player = player;

    socket.emit('auth.succeeded', playerJSON);
  } catch (err) {
    console.error('[error]', err);
    socket.emit('auth.failed', ['Invalid JWT token']);
  }
};

module.exports = {
  loginNormal,
  loginJWT,
}
