const config = require('../../../config');
const validator = require('../../../../shared/validator/index');

module.exports = async (socket, data) => {
  console.info('[info] submitActions', data);

  const validation = validator.validate(data, config.shared.validators.submitActions());

  if (!validation.passed) {
    console.error('[info] validation failed', validation.getErrors());
    return
  }

  if (!socket.player) {
    return;
  }

  const { actions } = data;

  if (actions.length === 0) {
    return;
  }

  socket.broadcastRoom('performActions', data);
};
