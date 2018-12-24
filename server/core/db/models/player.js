const Sequelize = require('sequelize');

module.exports = db => {
  return db.define('players', {
      id: {
        type: Sequelize.DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: Sequelize.DataTypes.STRING,
      password: Sequelize.DataTypes.STRING,
      stats: {
        type: Sequelize.DataTypes.INTEGER,
        defaultValue: 750,
      },
    },
    {
      freezeTableName: true,
    });
}
