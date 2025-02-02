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
  hasItem: (itemName) => {
    return localStorage.getItem(itemName) !== null;
  },
  removeItem: (itemName) => {
    localStorage.removeItem(itemName);
  },
  setItem: (itemName, itemValue) => {
    localStorage.setItem(itemName, JSON.stringify(itemValue));
  },
  getItem: (itemName, itemDefault) => {
    const item = JSON.parse(localStorage.getItem(itemName) ?? JSON.stringify(itemDefault));

    return itemDefault !== null && itemDefault !== undefined && itemDefault.constructor === Object
      ? Object.assign({}, itemDefault, item) : item;
  },
};

const oppRotation = new Map([
  [ 'N', 'S' ],
  [ 'E', 'W' ],
  [ 'S', 'N' ],
  [ 'W', 'E' ],
]);
const directions = [ 'N', 'E', 'S', 'W' ];

const gameConfigProps = {
  audio: true,
  barPosition: 'right',
  confirmBeforeCreate: false,
  confirmBeforeJoin: false,
  gameSpeed: 'auto',
  rotation: 'S',
  teamColorIds: [ 'Blue', 'Yellow', 'Red', 'Green' ],
};

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

  getTeamColorId(team) {
    return this.teamColorIds[directions.indexOf(team.position)];
  },

  _cache: new Map(),
  _get(itemName, itemDefault) {
    if (this._cache.has(itemName))
      return this._cache.get(itemName);
    else if (typeof localStorage !== 'undefined')
      return config.getItem(itemName, itemDefault);
    return itemDefault;
  },
  _set(itemName, itemValue) {
    this._cache.set(itemName, itemValue);
    if (typeof localStorage !== 'undefined')
      config.setItem(itemName, itemValue);
  },
};

for (const [ propName, propDefault ] of Object.entries(gameConfigProps)) {
  Object.defineProperty(gameConfig, propName, {
    ...(Object.getOwnPropertyDescriptor(gameConfig, propName)?.get ? {} : {
      get() {
        return this._get(propName, propDefault);
      },
    }),
    set(propValue) {
      this._set(propName, propValue);
    },
  });
}

if (!Object.values(config.auth).find(b => b === true))
  config.auth = false;

export default config;
