const validator = require('../../../../shared/validator');
const config = require('../../../config');
const commands = require('../../commands/index');

module.exports = async (socket, data) => {
  console.info('[info] message', data);

  // Clean incoming messages
  data.message = data.message.trim();

  if (!validator.validate({message: data.message}, {message: config.shared.validators.message}).passed) {
    return;
  }

  let type = 'message';

  const [message, command, args] = data.message.match(/^\/(\w+)\s?(.+)/);

  // Validate and parse command messages
  if (command && commands.hasOwnProperty(command)) {
    type = 'command';
    data.message = await commands[command](args);
  }

  socket.broadcast('message.received', {
    player: data.player,
    message: data.message,
    type,
    timestamp: Date.now(),
  });
};
