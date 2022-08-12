import setsById from 'config/sets.js';

export default {
  version: VERSION,
  apiPrefix: process.env.API_PREFIX ?? '',
  publicKey: process.env.PUBLIC_KEY,
  authEndpoint: process.env.AUTH_ENDPOINT,
  gameEndpoint: process.env.GAME_ENDPOINT,
  chatEndpoint: process.env.CHAT_ENDPOINT,
  pushEndpoint: process.env.PUSH_ENDPOINT,
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
  set: 'default',
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
