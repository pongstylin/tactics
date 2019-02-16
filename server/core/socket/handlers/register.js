const bcrypt = require('bcrypt');
const JWT = require('jsonwebtoken');
const state = require('../../state');
const config = require('../../../config');
const validator = require('../../../../shared/validator/index');
const models = require('../../db/models/index');

module.exports = async (socket, data) => {
  console.info('[info] register', data);

  const validation = validator.validate(data, config.shared.validators.register(data));

  if (!validation.passed) {
    socket.emit('auth.failed', validation.getErrors());
    return;
  }

  try {
    // Validate name doesn't already exist in DB
    if (await models.player.findOne({where: {username: data.username}})) {
      socket.emit('auth.failed', ['Username already taken']);
      console.error(`[error] user already exists ${data.username}`);
      return;
    }

    const password = await bcrypt.hash(data.password, config.saltRounds);
    const player = await models.player.create({username: data.username, password});
    const playerJSON = player.toJSON();

    playerJSON.token = JWT.sign({player: playerJSON}, config.key);
    socket.state.player = playerJSON;
    socket.state.token = playerJSON.token;

    socket.emit('auth.succeeded', playerJSON);
  } catch (err) {
    console.error('[error]', err);
    socket.emit('auth.failed', ['Failed to make account']);
  }
};
