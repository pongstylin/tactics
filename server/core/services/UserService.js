const bcrypt = require('bcrypt');
const config = require('../../config');
const JWT = require('jsonwebtoken');
const models = require('../db/models');

const createUser = async (username, rawPassword, isAnonymous=false) => {
  try {
    // Validate name doesn't already exist in DB
    if (await models.player.findOne({where: { username }})) {
      return {err: `Username ${username} already taken`};
    }

    const password = await bcrypt.hash(rawPassword, config.saltRounds);
    const player = await models.player.create({ username, password, isAnonymous });
    const playerJSON = player.toJSON();

    playerJSON.token = JWT.sign({player: playerJSON}, config.key);
    return { playerJSON, err: null }
  } catch (err) {
    console.error('[error]', err);
    return { err: 'Failed to make account' };
  }
};

module.exports = {
  createUser,
};