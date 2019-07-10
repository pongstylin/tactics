/*
 * Only useful for testing or recovery purposes.
 */
require('dotenv').config();

const jwt = require('jsonwebtoken');

let playerName = process.argv[2];
let deviceId   = process.argv[3];
let playerId   = process.argv[4];

console.log(
  jwt.sign({
    name: playerName,
    deviceId: deviceId,
  }, process.env.PRIVATE_KEY, {
    algorithm: 'RS512',
    expiresIn: '1h',
    subject: playerId,
  })
);
