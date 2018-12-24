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
    const password = await bcrypt.hash(data.password, config.saltRounds);
    const player = await models.player.create({
      username: data.username,
      password,
    });
    socket.emit('register.succeeded', player);
  } catch (err) {
    console.error('[error]', err);
    socket.emit('register.failed', ["Can't create your account, try again later"]);
  }
};
