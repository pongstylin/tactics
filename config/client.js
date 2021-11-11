import Version from 'models/Version.js';

export default {
  version: new Version(VERSION),
  apiPrefix: process.env.API_PREFIX ?? '',
  publicKey: process.env.PUBLIC_KEY,
  authEndpoint: process.env.AUTH_ENDPOINT,
  gameEndpoint: process.env.GAME_ENDPOINT,
  chatEndpoint: process.env.CHAT_ENDPOINT,
  pushEndpoint: process.env.PUSH_ENDPOINT,
  pushPublicKey: process.env.PN_PUBLIC_KEY,
};
