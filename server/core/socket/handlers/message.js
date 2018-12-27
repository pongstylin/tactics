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
  const message = data.message.match(/^\/(\w+)\s?(.+)?/);

  // Validate and parse command messages
  if (message && message[1] && commands.hasOwnProperty(message[1])) {
    type = 'command';
    data.message = await commands[message[1]](message[2]);
  }

  let socketEmitMethod = 'emit';
  let messageText = data.message;

  // Command messages may return a scope of either player or
  // all. Player will emit to itself and all will broadcast
  // to all players
  if (type === 'command' && typeof data.message === 'object') {
    socketEmitMethod = data.message.scope === 'all' ? 'broadcast' : 'emit';
    messageText = data.message.message;
  }

  socket[socketEmitMethod]('message.received', {
    player: data.player,
    message: messageText,
    type,
    timestamp: Date.now(),
  });
};
