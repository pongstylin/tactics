const config = require('../shared/config');

module.exports = {
  key: 'secret',
  port: process.env.PORT || 3000,
  shared: config,
  db: {
    dialect: 'mysql',
    host: 'mysql',
    port: 3306,
    name: 'tactics',
    username: 'tactics',
    password: 'secret',
  },
  saltRounds: 10,
}
