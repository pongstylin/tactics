const bcrypt = require('bcrypt');
const config = require('../../../config');
const validator = require('../../../../shared/validator/index');
const models = require('../../db/models/index');

module.exports = async (socket, data) => {
  console.info('[info] register', data);

  const validation = validator.validate(data, config.shared.validators.register(data));

  if (!validation.passed) {
    socket.emit('register.failed', validation.getErrors());
    return;
  }

  try {
    // Validate name doesn't already exist in DB
    if (await models.player.findOne({where: {username: data.username}})) {
      socket.emit('register.failed', ['Username already taken']);
      console.error(`[error] user already exists ${data.username}`);
      return;
    }

    const password = await bcrypt.hash(data.password, config.saltRounds);
    const player = await models.player.create({username: data.username, password});
    socket.emit('register.succeeded', player.toJSON());
  } catch (err) {
    console.error('[error]', err);
    socket.emit('register.failed', ['Failed to make account']);
  }
};
