const models = require('../db/models/index');

module.exports = async username => {
  const player = await models.player.findOne({where: {username}});
  if (!player) {
    return 'Player not found';
  }
  return `Player ${player.username} has ${player.stats} stats`;
}
