import setsById from '#config/sets.js';

const local = {
  secure: process.env.LOCAL_SECURE === 'true',
  host: process.env.LOCAL_HOST,
  port: process.env.LOCAL_PORT ? parseInt(process.env.LOCAL_PORT) : null,
  // The optional path part of API and WS endpoints.  Must not end with /
  path: process.env.LOCAL_PATH,

  // URLs constructed below
  origin: null,
  apiEndpoint: null,
  wsEndpoint: null,
};
const proxy = {
  secure: process.env.PROXY_SECURE === 'true',
  host: process.env.PROXY_HOST,
  port: process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT) : null,
  // The optional path part of API and WS endpoints.  Must not end with /
  path: process.env.PROXY_PATH,
};
const context = proxy.host ? proxy : local;

if (context.secure) {
  local.origin = `https://`;
  local.wsEndpoint = `wss://`;
} else {
  local.origin = `http://`;
  local.wsEndpoint = `ws://`;
}
local.origin += context.host;
local.wsEndpoint += context.host;
local.port ??= local.defaultPort = local.secure ? 443 : 80;
proxy.port ??= proxy.defaultPort = proxy.secure ? 443 : 80;

if (context.port !== context.defaultPort) {
  local.origin += `:${context.port}`;
  local.wsEndpoint += `:${context.port}`;
}
local.apiEndpoint = local.origin;

if (context.path) {
  local.apiEndpoint += context.path;
  local.wsEndpoint += context.path;
}

const config = {
  version: VERSION,
  local,
  publicKey: process.env.PUBLIC_KEY,
  auth: {
    discord: !!process.env.DISCORD_CLIENT_ID,
    facebook: !!process.env.FACEBOOK_CLIENT_ID,
  },
  authEndpoint: process.env.AUTH_ENDPOINT ?? local.wsEndpoint,
  gameEndpoint: process.env.GAME_ENDPOINT ?? local.wsEndpoint,
  chatEndpoint: process.env.CHAT_ENDPOINT ?? local.wsEndpoint,
  pushEndpoint: process.env.PUSH_ENDPOINT ?? local.wsEndpoint,
  pushPublicKey: process.env.PN_PUBLIC_KEY,
};

const setItem = (itemName, itemValue) => {
  localStorage.setItem(itemName, JSON.stringify(itemValue));
};
const getItem = (itemName, itemDefault) => {
  const itemValue = localStorage.getItem(itemName);
  return itemValue === null ? itemDefault : JSON.parse(itemValue);
};

const oppRotation = new Map([
  [ 'N', 'S' ],
  [ 'E', 'W' ],
  [ 'S', 'N' ],
  [ 'W', 'E' ],
]);

export const gameConfig = {
  get setsById() {
    return setsById;
  },

  get myColorId() {
    return this.teamColorIds[2];
  },
  get oppRotation() {
    return oppRotation.get(this.rotation);
  },
  get oppColorId() {
    return this.teamColorIds[0];
  },

  _cache: new Map(),
  _get(itemName, itemDefault) {
    if (this._cache.has(itemName))
      return this._cache.get(itemName);
    else if (typeof localStorage !== 'undefined')
      return getItem(itemName, itemDefault);
    return itemDefault;
  },
  _set(itemName, itemValue) {
    this._cache.set(itemName, itemValue);
    if (typeof localStorage !== 'undefined')
      setItem(itemName, itemValue);
  },
};

const gameConfigProps = {
  audio: true,
  gameSpeed: 'auto',
  barPosition: 'right',
  blockingSystem: 'luck',
  turnTimeLimit: 'standard',
  set: 'ask',
  randomSide: false,
  rotation: 'S',
  teamColorIds: [ 'Blue', 'Yellow', 'Red', 'Green' ],
};

for (const [ propName, propDefault ] of Object.entries(gameConfigProps)) {
  Object.defineProperty(gameConfig, propName, {
    get() {
      return this._get(propName, propDefault);
    },
    set(propValue) {
      this._set(propName, propValue);
    },
  });
}

/*
 * Temporary migration
 */
if (typeof localStorage !== 'undefined') {
  const settings = getItem('settings');
  if (settings) {
    for (const [ name, value ] of Object.entries(settings)) {
      setItem(name, value);
    }
    localStorage.removeItem('settings');
  }
}
if (!Object.values(config.auth).find(b => b === true))
  config.auth = false;

export default config;
