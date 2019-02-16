const Sequelize = require('sequelize');

module.exports = db => {
  const Games =  db.define('games', {
      id: {
        type: Sequelize.DataTypes.UUID,
        defaultValue: Sequelize.DataTypes.UUIDV4,
        primaryKey: true,
      }
    },
    {
      freezeTableName: true,
    });
  const Player = db.modelManager.getModel('players', { attribute: 'name' });
  Games.belongsTo(Player, {as: 'playerOne'});
  Games.belongsTo(Player, {as: 'playerTwo'});
  return Games;
};
