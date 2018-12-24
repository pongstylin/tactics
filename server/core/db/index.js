const Sequelize = require('sequelize');
const config = require('../../config');
const models = require('./models/index');

const db = new Sequelize(config.db.name, config.db.username, config.db.password, {
  host: config.db.host,
  dialect: config.db.dialect,
  port: config.db.port,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  // http://docs.sequelizejs.com/manual/tutorial/querying.html#operators
  operatorsAliases: false,
});

// Instantiate all models
for (let model in models) {
  if (models.hasOwnProperty(model)) {
    models[model] = models[model](db);
  }
}

module.exports = db;
