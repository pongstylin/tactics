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
    const instance = models[model](db);

    instance.prototype.toJSON = function () {
      // Remove hidden fields
      const values = Object.assign({}, this.get());
      for (let i = 0; i < instance.options.hidden.length; i++) {
        delete values[instance.options.hidden[i]];
      }
      return values;
    }

    models[model] = instance;
  }
}

module.exports = db;
