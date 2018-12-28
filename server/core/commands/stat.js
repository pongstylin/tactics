const models = require('../db/models/index');

module.exports = async (socket, player, username) => {
  username = username === '' ? player.username : username;
  const matchedPlayer = await models.player.findOne({where: {username}});
  if (!matchedPlayer) {
    return 'Player not found';
  }

  let message = `${matchedPlayer.username} has ${matchedPlayer.stats} stats`;

  if (matchedPlayer.username === username) {
    message = `Your have ${matchedPlayer.stats} stats`;
  }

  return {
    scope: 'player',
    message,
  };
}
