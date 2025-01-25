import config, { gameConfig } from 'config/client.js';

const authClient = Tactics.authClient;

/*
 * In theory, the bug that caused the bad data was fixed...
 * ...and this data fix is temporary.
 */
function getRepairedConfig(key) {
  const configData = config.getItem(key);

  if (!configData.collection) {
    config.setItem(key, Object.assign(configData, { collection:'public' }));
    report({
      type: 'debug',
      message: `Restored collection in ${key}`,
    });
  }

  if (!configData.vs || configData.vs === 'public') {
    config.setItem(key, Object.assign(configData, { vs:'anybody' }));
    report({
      type: 'debug',
      message: `Restored vs in ${key}`,
    });
  }

  return configData;
}

const styleConfig = {
  save(styleConfigData) {
    // Beware!  timeLimitName can be null for single player games
    if (styleConfigData.timeLimitName)
      if ([ 'week', 'day' ].includes(styleConfigData.timeLimitName))
        styleConfigData.longTimeLimitName = styleConfigData.timeLimitName;
      else if ([ 'pro', 'standard', 'blitz' ].includes(styleConfigData.timeLimitName))
        styleConfigData.shortTimeLimitName = styleConfigData.timeLimitName;

    this._default = Object.assign(this._default ?? {}, styleConfigData, {
      set: styleConfigData.set === 'random' ? 'random' : this._default.set ?? styleConfigData.set,
    });

    config.setItem('defaultStyleConfig', this._default);
    config.setItem(`${styleConfigData.gameTypeId}StyleConfig`, Object.assign(this.get(styleConfigData.gameTypeId), styleConfigData));
  },

  getDefault() {
    return this._default.gameTypeId;
  },
  isDefault(gameTypeId) {
    if (!gameTypeId)
      return false;

    return this._default.gameTypeId === gameTypeId;
  },
  has(gameTypeId) {
    if (!gameTypeId)
      return false;

    return config.hasItem(`${gameTypeId}StyleConfig`);
  },
  get(gameTypeId = null) {
    if (this.has(gameTypeId))
      return getRepairedConfig(`${gameTypeId}StyleConfig`);

    const defaultConfig = Object.assign({}, this._default);
    if (gameTypeId)
      defaultConfig.gameTypeId = gameTypeId;

    return defaultConfig;
  },

  makeCreateGameOptions(gameType, { name, timerType, styleConfigData }) {
    styleConfigData = Object.assign(this.get(gameType.id), styleConfigData);

    if (styleConfigData.vs === 'yourself') {
      styleConfigData.rules = 'practice';
      styleConfigData.rated = null;
    }

    const timeLimitName = timerType ? styleConfigData[`${timerType}TimeLimitName`] : styleConfigData.timeLimitName;
    const collection = styleConfigData.collection !== 'public' ? null : (
      [ 'week', 'day' ].includes(timeLimitName) ? 'public' : `lobby/${gameType.id}`
    );
    const gameOptionsData = {
      collection,
      timeLimitName,
      randomHitChance: styleConfigData.randomHitChance,
      randomFirstTurn: styleConfigData.slot === 'random',
      // Use null if there is no collection to detect the proper reason why a game is not rated.
      // Do not trust styleConfigData.rated to not be true for guests.  They might have logged out of a verified account.
      rated: collection && authClient.isVerified ? styleConfigData.rated : null,
      undoMode: styleConfigData.rules === 'tournament' ? 'strict' : styleConfigData.rules === 'practice' ? 'loose' : 'normal',
      autoSurrender: styleConfigData.rules === 'tournament' || collection !== null && collection.startsWith('lobby/'),
      strictFork: styleConfigData.rules === 'tournament',
      teams: [ null, null ],
    };

    const youSlot = styleConfigData.slot === 'random' ? 0 : styleConfigData.slot;
    gameOptionsData.teams[youSlot] = this.makeMyTeam(gameType, { name, styleConfigData });

    const themSlot = (youSlot + 1) % 2;
    if (styleConfigData.vs === 'yourself')
      // The set will be selected on the game page
      // ...unless the set is not customizable.
      gameOptionsData.teams[themSlot] = { playerId:authClient.playerId };
    else if (styleConfigData.vs === 'invite')
      gameOptionsData.teams[themSlot] = { invite:true };
    else if (styleConfigData.vs === 'challenge')
      gameOptionsData.teams[themSlot] = { playerId:styleConfigData.challengee };

    return gameOptionsData;
  },
  makeMyTeam(gameType, { name, isFork, styleConfigData }) {
    styleConfigData = Object.assign({}, this.get(gameType.id), styleConfigData);

    return {
      playerId: authClient.playerId,
      name,
      set: isFork ? undefined : styleConfigData.set,
      randomSide: gameType.hasFixedPositions || [ 'same', 'mirror' ].includes(styleConfigData.set)
        ? false : styleConfigData.randomSide,
    };
  },

  _default: null,
};

(() => {
  if (config.hasItem('defaultStyleConfig'))
    return styleConfig._default = getRepairedConfig('defaultStyleConfig');

  const defaultStyleConfig = {
    gameTypeId: 'freestyle',
    collection: 'public',
    vs: 'anybody',
    set: 'default',
    timeLimitName: 'week',
    longTimeLimitName: 'week',
    shortTimeLimitName: 'standard',
    mode: null,
    randomHitChance: true,
    slot: 'random',
    rated: null,
    randomSide: false,
    rules: null,
    challengee: null,
  };

  /*
   * Temporary migration
   */
  if (config.hasItem('set')) {
    defaultStyleConfig.set = config.getItem('set');
    if (defaultStyleConfig.set === 'ask') {
      defaultStyleConfig.set = 'default';
      gameConfig.confirmBeforeCreate = true;
      gameConfig.confirmBeforeJoin = true;
    }
    config.removeItem('set');
  }
  if (config.hasItem('turnTimeLimit')) {
    defaultStyleConfig.shortTurnTimeLimit = config.getItem('turnTimeLimit');
    if (defaultStyleConfig.shortTurnTimeLimit === 'ask') {
      defaultStyleConfig.shortTurnTimeLimit = 'standard';
      gameConfig.confirmBeforeCreate = true;
    }
    config.removeItem('turnTimeLimit');
  }
  if (config.hasItem('randomSide')) {
    defaultStyleConfig.randomSide = config.getItem('randomSide');
    config.removeItem('randomSide');
  }
  if (config.hasItem('blockingSystem')) {
    defaultStyleConfig.randomHitChance = config.getItem('blockingSystem');
    if (defaultStyleConfig.randomHitChance === 'ask') {
      defaultStyleConfig.randomHitChance = true;
      gameConfig.confirmBeforeCreate = true;
    } else {
      defaultStyleConfig.randomHitChance = defaultStyleConfig.randomHitChance === 'luck';
    }
    config.removeItem('blockingSystem');
  }
  if (config.hasItem('ranked')) {
    defaultStyleConfig.rated = config.getItem('ranked');
    if (defaultStyleConfig.rated === 'ask') {
      defaultStyleConfig.rated = null;
      gameConfig.confirmBeforeCreate = true;
      gameConfig.confirmBeforeJoin = true;
    } else if (defaultStyleConfig.rated === 'any')
      defaultStyleConfig.rated = null;
    else
      defaultStyleConfig.rated = defaultStyleConfig.rated === 'yes';
    config.removeItem('ranked');
  }

  styleConfig._default = defaultStyleConfig;
  config.setItem('defaultStyleConfig', defaultStyleConfig);
})();

export default styleConfig;
