const Sequelize = require('sequelize');

module.exports = db => {
  return db.define('players', {
      id: {
        type: Sequelize.DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      password: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false,
      },
      stats: {
        type: Sequelize.DataTypes.INTEGER,
        defaultValue: 750,
      },
    },
    {
      freezeTableName: true,
      hidden: [
        'password',
      ],
    });
}
