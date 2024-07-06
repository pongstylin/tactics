import uaparser from 'ua-parser-js';

import setsById from '#config/sets.js';
import timeLimit from '#config/timeLimit.js';
import AccessToken from '#server/AccessToken.js';
import Service from '#server/Service.js';
import ServerError from '#server/Error.js';
import Timeout from '#server/Timeout.js';
import Game from '#models/Game.js';
import Team from '#models/Team.js';
import Player from '#models/Player.js';
import PlayerStats from '#models/PlayerStats.js';
import serializer, { unionType } from '#utils/serializer.js';

// When the server is shut down in the middle of an auto surrender game,
// the participants are allowed to safely bail on the game if they do not
// show up.  When their time limit expires, the game ends in truce.
const protectedGameIds = new Set();
const ACTIVE_LIMIT = 120;
const idleWatcher = function (session, oldIdle) {
  const newInactive = session.idle > ACTIVE_LIMIT;
  const oldInactive = oldIdle > ACTIVE_LIMIT;

  if (newInactive !== oldInactive) {
    for (const gameId of session.watchers) {
      this._setGamePlayersStatus(gameId);
    }
  }
};

export default class GameService extends Service {
  constructor(props) {
    super({
      ...props,

      startupAt: new Date(),
      attachedGames: new WeakSet(),

      /*
       * Entity: Any identifiable thing that exists apart from any other thing.
       *   Example: A player.
       * Data: Commonly the data that represents an entity.
       *   Example: A player's name.
       * Paradata: The data surrounding an entity, but doesn't describe it.
       *   Example: A player's session.
       */
      // Paradata about each active client by client ID.
      clientPara: new Map(),

      // Paradata about each watched game by game ID.
      gamePara: new Map(),

      // Paradata about each watched collection by collection ID.
      collectionPara: new Map(),

      // Paradata about each online player by player ID.
      playerPara: new Map(),
    });

    this.setValidation({
      authorize: { token: AccessToken },
      requests: {
        createGame: ['string', 'game:options'],
        tagGame: ['uuid', 'game:tags'],
        forkGame: ['uuid', 'game:forkOptions'],
        cancelGame: ['uuid'],
        joinGame: `tuple([ 'uuid', 'game:joinTeam' ], 1)`,

        getGameTypes: [],
        getGameTypeConfig: ['string'],
        getGame: ['uuid'],
        getTurnData: ['uuid', 'integer(0)'],
        getTurnActions: ['uuid', 'integer(0)'],

        action: ['game:group', 'game:newAction | game:newAction[]'],
        playerRequest: ['game:group', `enum(['undo','truce'])`],
        getPlayerStatus: ['game:group'],
        getPlayerActivity: ['game:group', 'uuid'],
        getPlayerInfo: ['game:group', 'uuid'],
        getMyInfo: [],
        clearWLDStats: `tuple([ 'uuid', 'string | null' ], 1)`,

        searchGameCollection: ['string', 'any'],
        searchMyGames: ['any'],

        getPlayerSets: ['string'],
        getPlayerSet: ['string', 'string'],
        savePlayerSet: ['string', 'game:set'],
        deletePlayerSet: ['string', 'string'],

        getMyAvatar: [],
        saveMyAvatar: ['game:avatar'],
        getMyAvatarList: [],
        getPlayersAvatar: ['uuid[]'],
      },
      events: {
        'playerRequest:accept': ['game:group', 'Date'],
        'playerRequest:reject': ['game:group', 'Date'],
        'playerRequest:cancel': ['game:group', 'Date'],
      },
      definitions: {
        group: 'string(/^\\/games\\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/)',
        coords: ['integer(0,10)', 'integer(0,10)'],
        direction: `enum(['N','S','E','W'])`,
        newUnit: {
          type: 'string',
          assignment: 'game:coords',
          'direction?': 'game:direction',
        },
        set: {
          id: 'string',
          name: 'string',
          units: 'game:newUnit[]',
        },
        tempSet: {
          units: 'game:newUnit[]',
        },
        setOption: unionType(
          'game:tempSet',
          `enum([ 'same', 'mirror', 'random', '${[...setsById.keys()].join("','")}' ])`,
        ),
        newTeam: unionType(
          'null',
          {
            'playerId?': 'uuid',
            'name?': 'string',
            'set?': 'game:setOption',
            'randomSide?': 'boolean',
          },
        ),
        joinTeam: {
          'name?': 'string',
          'set?': 'game:setOption',
          'randomSide?': 'boolean',
          'slot?': 'integer(0,4)',
        },
        tags: `dict('string | number | boolean')`,
        options: {
          teams: 'game:newTeam[2] | game:newTeam[4]',
          'collection?': 'string',
          'randomFirstTurn?': 'boolean',
          'randomHitChance?': 'boolean',
          'strictUndo?': 'boolean',
          'strictFork?': 'boolean',
          'autoSurrender?': 'boolean',
          'rated?': 'boolean',
          'timeLimitName?': `enum([ 'blitz', 'standard', 'relaxed', 'day', 'week' ])`,
          'tags?': 'game:tags',
        },
        forkOptions: unionType(
          {
            'vs?': `const('you')`,
            'turnId?': 'integer(0)',
          },
          {
            vs: `const('private')`,
            as: `integer(0,4)`,
            'turnId?': 'integer(0)',
          },
        ),
        newAction: unionType(
          {
            type: `const('move')`,
            unit: 'integer(0)',
            assignment: 'game:coords',
          },
          {
            type: `const('attack')`,
            unit: 'integer(0)',
            'target?': 'game:coords',
            'direction?': 'game:direction',
          },
          {
            type: `const('attackSpecial')`,
            unit: 'integer(0)',
          },
          {
            type: `const('turn')`,
            unit: 'integer(0)',
            direction: 'game:direction',
          },
          {
            type: `const('endTurn')`,
          },
          {
            type: `const('surrender')`,
            'teamId?': 'integer(0,3)',
          },
        ),
        avatar: {
          unitType: 'string',
          colorId: 'string',
        },
      },
    });

    this.setCollections();

    this.idleWatcher = idleWatcher.bind(this);
  }

  async initialize() {
    const state = this.data.state;

    if (!state.willSync)
      state.willSync = new Timeout(`${this.name}WillSync`);
    state.willSync.on('expire', async ({ data:items }) => {
      for (const game of await this._getGames(items.keys())) {
        game.state.sync('willSync');
      }
    });

    if (!state.autoSurrender)
      state.autoSurrender = new Timeout(`${this.name}AutoSurrender`);
    state.autoSurrender.on('expire', async ({ data:items }) => {
      for (const game of await this._getGames(items.keys())) {
        // Just in case they finished their turn at the very last moment.
        if (game.state.endedAt)
          continue;
        else if (game.state.getTurnTimeRemaining() > 0) {
          state.autoSurrender.add(game.id, true, game.state.getTurnTimeRemaining());
          continue;
        }

        if (protectedGameIds.has(game.id) && !game.state.currentTeam.seen(this.startupAt)) {
          protectedGameIds.delete(game.id);
          game.state.end('truce');
        } else if (game.state.actions.length === 0)
          game.state.submitAction({
            type: 'surrender',
            declaredBy: 'system',
          });
        else if (game.state.actions.last.type !== 'endTurn')
          game.state.submitAction({
            type: 'endTurn',
            forced: true,
          });
      }
    });

    if (!state.autoCancel)
      state.autoCancel = new Timeout(`${this.name}AutoCancel`);
    state.autoCancel.on('expire', async ({ data:items }) => {
      for (const game of await this._getGames(items.keys()))
        if (!game.state.startedAt)
          game.cancel();
    });

    if (state.shutdownAt) {
      delete state.shutdownAt;

      state.autoSurrender.pause();

      for (const gameId of state.autoSurrender.keys()) {
        let game;
        try {
          game = await this._getGame(gameId);
        } catch (e) {
          // Only expected to happen when manually deleting files.
          state.autoSurrender.delete(gameId);
          continue;
        }

        if (game.state.getTurnTimeRemaining() < 300000) {
          protectedGameIds.add(game.id);
          game.state.currentTurn.resetTimeLimit(300);
          state.autoSurrender.add(game.id, true, game.state.getTurnTimeRemaining());
          this._notifyYourTurn(game);
        }
      }

      state.autoSurrender.resume();
    }

    return super.initialize();
  }

  async cleanup() {
    const state = this.data.state;
    state.autoSurrender.pause();
    for (const game of await this._getGames(state.autoCancel.keys()))
      if (!game.state.startedAt)
        game.cancel();
    state.willSync.pause();
    state.shutdownAt = new Date();

    return super.cleanup();
  }

  /*
   * Test if the service will handle the message from client
   */
  will(client, messageType, body) {
    super.will(client, messageType, body);
    if (messageType === 'authorize')
      return;

    // No authorization required
    if (body.method === 'getGame') return true;
    if (body.method === 'getTurnData') return true;
    if (body.method === 'getTurnActions') return true;
    if (body.method === 'getGameTypeConfig') return true;
    if (body.method === 'getGameTypes') return true;

    // Authorization required
    const clientPara = this.clientPara.get(client.id);
    if (!clientPara)
      throw new ServerError(401, 'Authorization is required');
    if (clientPara.token.isExpired)
      throw new ServerError(401, 'Token is expired');
  }

  dropClient(client) {
    const clientPara = this.clientPara.get(client.id);
    if (!clientPara) return;

    const playerId = clientPara.playerId;
    this.auth.closePlayer(playerId);
    this.data.closePlayer(playerId);

    const playerPara = this.playerPara.get(playerId);
    if (playerPara.clients.size > 1)
      playerPara.clients.delete(client.id);
    else {
      this.playerPara.delete(playerId);
      this.push.hasAnyPushSubscription(playerId).then(extended => {
        // Make sure the player is still logged out
        if (!this.playerPara.has(playerId))
          this._closeAutoCancel(playerId, extended);
      });
    }

    this.clientPara.delete(client.id);

    // Let people who needs to know about a potential status change.
    this._setPlayerGamesStatus(playerId);
  }

  /*
   * Generate a 'yourTurn' notification to indicate that it is currently the
   * player's turn for X number of games.  If only one game, then it provides
   * details for the game and may link to that game.  Otherwise, it indicates
   * the number of games and may link to the active games page.
   */
  async getYourTurnNotification(playerId) {
    let gamesSummary = await this.data.listMyTurnGamesSummary(playerId);

    /*
     * Exclude games the player is actively playing.
     */
    const playerPara = this.playerPara.get(playerId);
    if (playerPara)
      gamesSummary = gamesSummary
        .filter(gs => !playerPara.joinedGameGroups.has(gs.id));

    const notification = {
      type: 'yourTurn',
      createdAt: new Date(),
      gameCount: gamesSummary.length,
    };

    if (gamesSummary.length === 0)
      return notification;
    else if (gamesSummary.length > 1) {
      notification.turnStartedAt = new Date(
        Math.max(...gamesSummary.map(gs => gs.updatedAt))
      );
      return notification;
    } else
      notification.turnStartedAt = gamesSummary[0].updatedAt;

    // Search for the next opponent team after this team.
    // Useful for 4-team games.
    const teams = gamesSummary[0].teams;
    const teamId = gamesSummary[0].currentTeamId;
    let opponentTeam;
    for (let i = 1; i < teams.length; i++) {
      const nextTeam = teams[(teamId + i) % teams.length];
      if (nextTeam.playerId === playerId) continue;

      opponentTeam = nextTeam;
      break;
    }

    return Object.assign(notification, {
      gameId: gamesSummary[0].id,
      opponent: opponentTeam.name,
    });
  }

  blockPlayer(clientPlayerId, playerId) {
    this.data.surrenderPendingGames(clientPlayerId, playerId);
  }

  setCollections() {
    const items = Object.clone(this.config.collections);
    const collections = new Map();
    const collectionGroups = new Map();

    while (items.length) {
      const item = items.shift();
      collectionGroups.set(item.name, []);

      if (!item.collections) {
        let node = item;
        while (node) {
          collectionGroups.get(node.name).push(item.name);
          node = node.parent;
        }

        collections.set(item.name, item);
        continue;
      }

      const template = {
        gameType: item.gameType,
        gameOptions: item.gameOptions,
      };
      const parent = {
        name: item.name,
        numPendingGamesPerPlayer: item.numPendingGamesPerPlayer,
        parent: item.parent,
      };

      for (const subItem of item.collections) {
        const name = `${item.name}/${subItem.name}`;
        const newItem = Object.merge(template, subItem, { name, parent });

        if (newItem.gameOptions?.schema) {
          const schema = newItem.gameOptions.schema;
          delete newItem.gameOptions.schema;

          newItem.gameOptions.validator = serializer.makeValidator(`game:/gameOptions/${name}`, schema);
        }

        items.push(newItem);
      }
    }

    this.collections = collections;
    this.collectionGroups = collectionGroups;
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  async onAuthorize(client, { token }) {
    if (!this.clientPara.has(client.id)) {
      const playerId = token.playerId;
      const clientPara = {
        joinedGroups: new Set(),
        playerId,
        deviceType: uaparser(client.agent).device.type,
      };

      await Promise.all([
        this.auth.openPlayer(playerId),
        this.data.openPlayer(playerId),
      ]).then(([player]) => clientPara.player = player);
      if (client.closed) {
        this.auth.closePlayer(playerId);
        this.data.closePlayer(playerId);
        return;
      }

      this.clientPara.set(client.id, clientPara);
    }

    const clientPara = this.clientPara.get(client.id);
    if (clientPara.playerId !== token.playerId)
      throw new ServerError(501, 'Unsupported change of player');

    clientPara.client = client;
    clientPara.token = token;
    clientPara.name = token.playerName;

    const player = clientPara.player;
    const playerPara = this.playerPara.get(player.id);
    if (playerPara)
      // This operation would be redundant if client authorizes more than once.
      playerPara.clients.add(client.id);
    else {
      this.playerPara.set(player.id, {
        player,
        clients: new Set([client.id]),
        joinedGameGroups: new Map(),
      });

      // Let people who needs to know that this player is online.
      this._setPlayerGamesStatus(player.id);
      this._reopenAutoCancel(player.id);
    }
  }

  /*
   * The group SHOULD be closed on game end because no more events or requests are
   * accepted for the game.  But there are two things that still require it:
   *  1) Resuming or replaying a game.  Someone may have gone inactive mid-game
   *  and wish to resume it post-game.  This function should be separated from the
   *  game group as we add support for replaying completed games.
   *
   *  2) Player status.  The players may continue to chat after game end, but wish
   *  to know if their opponent is still present.  For active game groups, we want
   *  to track the player's online or active status.  But for chat groups, we only
   *  want to track whether the player is inchat or not.  This should be managed
   *  separately from game groups.
   *
    onGameEnd(gameId) {
      const gamePara = this.gamePara.get(gameId);
      gamePara.clients.keys().forEach(clientId =>
        this.clientPara.get(clientId).joinedGroups.delete(`/games/${gameId}`)
      );
      this.gamePara.delete(gameId);
  
      this._emit({
        type: 'closeGroup',
        body: {
          group: `/games/${gameId}`,
        },
      });
    }
  */

  /*
   * Create a new game and save it to persistent storage.
   */
  async onCreateGameRequest(client, gameTypeId, gameOptions) {
    const clientPara = this.clientPara.get(client.id);
    const playerId = clientPara.playerId;

    if (gameOptions.collection)
      await this._validateCreateGameForCollection(gameTypeId, gameOptions);

    if (gameOptions.teams.findIndex(t => t?.playerId === playerId && t.set !== undefined) === -1)
      throw new ServerError(400, 'You must join games that you create');

    const isMultiplayer = gameOptions.teams.findIndex(t => t?.playerId !== playerId) > -1;
    if (gameOptions.rated && !isMultiplayer)
      throw new ServerError(400, 'Practice games can\'t be rated');

    gameOptions.createdBy = playerId;
    gameOptions.type = gameTypeId;

    if (gameOptions.timeLimitName) {
      gameOptions.timeLimit = timeLimit[gameOptions.timeLimitName].clone();
      if (gameOptions.rated && gameOptions.timeLimit.base <= 30)
        gameOptions.strictUndo = true;
    } else {
      if (isMultiplayer)
        gameOptions.timeLimit = timeLimit.week.clone();
    }

    const game = Game.create({
      ...gameOptions,
      teams: new Array(gameOptions.teams.length).fill(null),
    });
    const gameType = await this.data.getGameType(gameTypeId);

    for (const [slot, teamData] of gameOptions.teams.entries()) {
      if (!teamData) continue;

      teamData.slot = slot;

      if (teamData.playerId) {
        const player = await this._getAuthPlayer(teamData.playerId);
        if (!player)
          throw new ServerError(404, `Team ${slot} has an unrecognized playerId`);
        if (teamData.name !== undefined && teamData.name !== null)
          Player.validatePlayerName(teamData.name, player.identity);
      } else if (teamData.name !== undefined)
        throw new ServerError(400, `Team ${slot} playerId field is required a name is present`);

      let team;
      if (teamData.playerId && teamData.playerId !== playerId)
        team = Team.createReserve(teamData, clientPara);
      else if (teamData.set === undefined && gameType.isCustomizable)
        team = Team.createReserve(teamData, clientPara);
      else
        team = Team.createJoin(teamData, clientPara, game, gameType);

      await this._joinGame(game, gameType, team);
    }

    // Create the game before generating a notification to ensure it is accurate.
    await this._createGame(game);

    /*
     * Notify the player that goes first that it is their turn.
     * ...unless the player to go first just created the game.
     */
    if (game.state.startedAt)
      if (game.state.currentTeam.playerId !== playerId)
        this._notifyYourTurn(game);

    return game.id;
  }
  async onTagGameRequest(client, gameId, tags) {
    const clientPara = this.clientPara.get(client.id);
    const game = await this._getGame(gameId);

    if (game.createdBy !== clientPara.playerId)
      throw new ServerError(403, `May not tag someone else's game`);

    game.mergeTags(tags);
  }

  async onForkGameRequest(client, gameId, options) {
    this.debug(`forkGame: gameId=${gameId}; turnId=${options.turnId}, vs=${options.vs}, as=${options.as}`);

    const clientPara = this.clientPara.get(client.id);
    const game = await this._getGame(gameId);
    const newGame = game.fork(clientPara, options);

    await this._createGame(newGame);

    return newGame.id;
  }

  async onJoinGameRequest(client, gameId, teamData = {}) {
    this.debug(`joinGame: gameId=${gameId}`);

    const clientPara = this.clientPara.get(client.id);
    const playerId = clientPara.playerId;
    const game = await this._getGame(gameId);
    if (game.state.startedAt)
      throw new ServerError(409, 'The game has already started.');

    if (game.collection)
      await this._validateJoinGameForCollection(playerId, this.collections.get(game.collection));

    const player = this.playerPara.get(playerId).player;
    const creator = await this._getAuthPlayer(game.createdBy);
    if (creator.hasBlocked(player, !!game.collection))
      throw new ServerError(403, 'You are blocked from joining this game.');

    if (teamData.name !== undefined && teamData.name !== null)
      Player.validatePlayerName(teamData.name, player.identity);

    /*
     * You can't play a blocked player.  But you can downgrade them to muted first.
     */
    if (player.hasBlocked(creator, false)) {
      const relationship = player.getRelationship(creator);
      player.mute(creator, relationship.name);
    }

    const gameType = await this.data.getGameType(game.state.type);
    const teams = game.state.teams;

    let openSlot = teams.findIndex(t => !t?.playerId);
    if (openSlot === -1) openSlot = null;

    let reservedSlot = teams.findIndex(t => !t?.joinedAt && t?.playerId === playerId);
    if (reservedSlot === -1) reservedSlot = null;

    // You may not join a game under more than one team
    // ...unless a slot was reserved for you, e.g. practice game.
    if (reservedSlot === null && teams.findIndex(t => t?.joinedAt && t.playerId === playerId) !== -1)
      throw new ServerError(409, 'Already joined this game');

    let team;
    if (teamData.slot === undefined || teamData.slot === null) {
      teamData.slot = reservedSlot ?? openSlot;

      // If still not found, can't join!
      if (teamData.slot === null)
        throw new ServerError(409, 'No slots are available');

      team = teams[teamData.slot];
    } else {
      if (typeof teamData.slot !== 'number')
        throw new ServerError(400, 'Invalid slot');

      team = teams[teamData.slot];
      if (team === undefined)
        throw new ServerError(400, 'The slot does not exist');
      if (reservedSlot !== null && reservedSlot !== teamData.slot)
        throw new ServerError(403, 'Must join the reserved team');
    }

    /*
     * A player may join a pre-existing team, e.g. on forked or practice games.
     */
    if (team)
      team.join(teamData, clientPara, game, gameType);
    else
      team = Team.createJoin(teamData, clientPara, game, gameType);

    await this._joinGame(game, gameType, team);

    if (this.gamePara.has(game.id))
      this._setGamePlayersStatus(game.id);

    /*
     * Notify the player that goes first that it is their turn.
     * ...unless the player to go first just joined.
     */
    if (game.state.startedAt)
      if (game.state.currentTeam.playerId !== playerId)
        this._notifyYourTurn(game);
  }

  async onCancelGameRequest(client, gameId) {
    this.debug(`cancelGame: gameId=${gameId}`);

    const clientPara = this.clientPara.get(client.id);
    const game = await this._getGame(gameId);
    if (clientPara.playerId !== game.createdBy)
      throw new ServerError(403, 'You cannot cancel other users\' game');

    const gamePara = this.gamePara.get(gameId);
    if (gamePara)
      for (const clientId of gamePara.clients.keys())
        this.onLeaveGameGroup(this.clientPara.get(clientId).client, `/games/${gameId}`, gameId);

    game.cancel();
  }

  async onGetGameTypesRequest(client) {
    const gameTypes = this.data.getGameTypesById();

    return [ ...gameTypes.values() ]
      .filter(gt => !gt.config.archived)
      .map(({ id, config }) => ({
        id: id,
        name: config.name,
      }));
  }

  async onGetGameTypeConfigRequest(client, gameTypeId) {
    return this.data.getGameType(gameTypeId);
  }

  async onGetPlayerSetsRequest(client, gameTypeId) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.getPlayerSets(clientPara.playerId, gameTypeId);
  }
  async onGetPlayerSetRequest(client, gameTypeId, setId) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.getPlayerSet(clientPara.playerId, gameTypeId, setId);
  }
  async onSavePlayerSetRequest(client, gameTypeId, set) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.setPlayerSet(clientPara.playerId, gameTypeId, set);
  }
  async onDeletePlayerSetRequest(client, gameTypeId, setId) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.unsetPlayerSet(clientPara.playerId, gameTypeId, setId);
  }

  async onGetMyAvatarRequest(client) {
    const clientPara = this.clientPara.get(client.id);
    const playerAvatars = await this.data.getPlayerAvatars(clientPara.playerId);

    return playerAvatars.avatar;
  }
  async onSaveMyAvatarRequest(client, avatar) {
    const clientPara = this.clientPara.get(client.id);
    const playerAvatars = await this.data.getPlayerAvatars(clientPara.playerId);

    playerAvatars.avatar = avatar;
  }
  async onGetMyAvatarListRequest(client) {
    const clientPara = this.clientPara.get(client.id);
    const playerAvatars = await this.data.getPlayerAvatars(clientPara.playerId);

    return playerAvatars.list;
  }
  async onGetPlayersAvatarRequest(client, playerIds) {
    const playersAvatar = await Promise.all(playerIds.map(pId => this.data.getPlayerAvatars(pId)));

    return playersAvatar.map(pa => pa.avatar);
  }

  async onGetGameRequest(client, gameId) {
    this.throttle(client.address, 'getGame');

    /*
     * When getting a game, leave out the turn history as an efficiency measure.
     */
    const clientPara = this.clientPara.get(client.id);
    const game = await this._getGame(gameId);

    return game.getSyncForPlayer(clientPara?.playerId);
  }
  async onGetTurnDataRequest(client, gameId, ...args) {
    this.throttle(client.address, 'getTurnData', 300, 300);

    const game = await this._getGame(gameId);

    return game.state.getTurnData(...args);
  }
  async onGetTurnActionsRequest(client, gameId, ...args) {
    this.throttle(client.address, 'getTurnData', 300, 300);

    const game = await this._getGame(gameId);

    return game.state.getTurnActions(...args);
  }

  async onGetPlayerStatusRequest(client, groupPath) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const clientPara = this.clientPara.get(client.id);
    if (!clientPara.joinedGroups.has(groupPath))
      throw new ServerError(412, 'To get player status for this game, you must first join it');

    const gamePara = this.gamePara.get(gameId);
    return [...gamePara.playerStatus]
      .map(([playerId, playerStatus]) => ({ playerId, ...playerStatus }));
  }
  async onGetPlayerActivityRequest(client, groupPath, forPlayerId) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const clientPara = this.clientPara.get(client.id);
    if (!clientPara.joinedGroups.has(groupPath))
      throw new ServerError(412, 'To get player activity for this game, you must first join it');

    const game = this.data.getOpenGame(gameId);
    if (!game.state.startedAt)
      throw new ServerError(403, 'To get player activity for this game, the game must first start.');
    if (game.state.endedAt)
      throw new ServerError(403, 'May not get player activity for an ended game.');

    const inPlayerId = this.clientPara.get(client.id).playerId;
    if (inPlayerId === forPlayerId)
      throw new ServerError(403, 'May not get player activity for yourself.');
    if (!game.state.teams.find(t => t.playerId === inPlayerId))
      throw new ServerError(403, 'To get player activity for this game, you must be a participant.');
    if (!game.state.teams.find(t => t.playerId === forPlayerId))
      throw new ServerError(403, 'To get player activity for this game, they must be a participant.');

    const playerPara = this.playerPara.get(forPlayerId);
    const playerActivity = {
      generalStatus: 'offline',
      gameStatus: 'closed',
      idle: await this._getPlayerIdle(forPlayerId),
      gameIdle: this._getPlayerGameIdle(forPlayerId, game),
    };

    if (playerPara) {
      playerActivity.generalStatus = playerActivity.idle > ACTIVE_LIMIT ? 'inactive' : 'active';
      playerActivity.gameStatus = playerPara.joinedGameGroups.has(gameId)
        ? playerActivity.gameIdle > ACTIVE_LIMIT ? 'inactive' : 'active'
        : 'closed';
      playerActivity.activity = await this._getPlayerActivity(forPlayerId, gameId, inPlayerId);
    }

    return playerActivity;
  }
  async onGetPlayerInfoRequest(client, groupPath, forPlayerId) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const clientPara = this.clientPara.get(client.id);
    if (!clientPara.joinedGroups.has(groupPath))
      throw new ServerError(412, 'To get player activity for this game, you must first join it');

    const game = this.data.getOpenGame(gameId);
    if (!game.state.startedAt)
      throw new ServerError(403, 'To get player info for this game, the game must first start.');

    const inPlayerId = this.clientPara.get(client.id).playerId;
    if (inPlayerId === forPlayerId)
      throw new ServerError(403, 'May not get player info for yourself.');
    if (!game.state.teams.find(t => t.playerId === inPlayerId))
      throw new ServerError(403, 'To get player info for this game, you must be a participant.');

    const team = game.state.teams.find(t => t.playerId === forPlayerId);
    if (!team)
      throw new ServerError(403, 'To get player info for this game, they must be a participant.');

    const gameTypesById = await this.data.getGameTypesById();
    const me = await this._getAuthPlayer(inPlayerId);
    const them = await this._getAuthPlayer(forPlayerId);
    const globalStats = await this.data.getPlayerStats(forPlayerId);
    const localStats = await this.data.getPlayerInfo(inPlayerId, forPlayerId);

    return {
      createdAt: them.createdAt,
      completed: globalStats.completed,
      canNotify: await this.push.hasAnyPushSubscription(forPlayerId),
      acl: new Map([
        ['me', me.acl],
        ['them', them.acl],
      ]),
      isNew: new Map([
        ['me', me.isNew],
        ['them', them.isNew],
      ]),
      isVerified: new Map([
        ['me', me.isVerified],
        ['them', them.isVerified],
      ]),
      relationship: me.getRelationship(them),
      stats: {
        ratings: [ ...globalStats.ratings ].map(([ gtId, r ]) => ({
          gameTypeId: gtId,
          gameTypeName: gtId === 'FORTE' ? 'Forte' : gameTypesById.get(gtId).name,
          rating: r.rating,
          gameCount: r.gameCount,
        })).sort((a,b) => b.rating - a.rating),
        aliases: [...localStats.aliases.values()]
          .filter(a => a.name.toLowerCase() !== team.name.toLowerCase())
          .sort((a, b) =>
            b.count - a.count || b.lastSeenAt - a.lastSeenAt
          )
          .slice(0, 10),
        all: localStats.all,
        style: localStats.style.get(game.state.type) ?? {
          win:  [ 0, 0 ],
          lose: [ 0, 0 ],
          draw: [ 0, 0 ],
        },
      },
    };
  }
  async onGetMyInfoRequest(client) {
    const playerId = this.clientPara.get(client.id).playerId;
    const player = await this._getAuthPlayer(playerId);
    const gameTypesById = await this.data.getGameTypesById();
    const myStats = await this.data.getPlayerStats(playerId);

    return {
      createdAt: player.createdAt,
      completed: myStats.completed,
      isVerified: player.isVerified,
      stats: {
        ratings: [ ...myStats.ratings ].map(([ gtId, r ]) => ({
          gameTypeId: gtId,
          gameTypeName: gtId === 'FORTE' ? 'Forte' : gameTypesById.get(gtId).name,
          rating: r.rating,
          gameCount: r.gameCount,
        })).sort((a,b) => b.rating - a.rating),
      },
    };
  }
  async onClearWLDStatsRequest(client, vsPlayerId, gameTypeId) {
    const playerId = this.clientPara.get(client.id).playerId;
    await this.data.clearPlayerWLDStats(playerId, vsPlayerId, gameTypeId);
  }

  async onSearchMyGamesRequest(client, query) {
    const player = this.clientPara.get(client.id).player;
    return this.data.searchPlayerGames(player, query);
  }
  async onSearchGameCollectionRequest(client, collectionId, query) {
    if (!this.collections.has(collectionId))
      throw new ServerError(400, 'Unrecognized game collection');

    const player = this.clientPara.get(client.id).player;
    return this._searchGameCollection(player, collectionId, query);
  }

  /*
   * Start sending change events to the client about this game.
   */
  onJoinGroup(client, groupPath, params) {
    if (groupPath.startsWith('/games/'))
      return this.onJoinGameGroup(client, groupPath, groupPath.slice(7), params);
    else if (groupPath.startsWith('/myGames/'))
      return this.onJoinMyGamesGroup(client, groupPath, groupPath.slice(9), params);
    else if (groupPath === '/collections' || groupPath.startsWith('/collections/'))
      return this.onJoinCollectionGroup(client, groupPath, groupPath.slice(13), params);
    else
      throw new ServerError(404, 'No such group');
  }
  onLeaveGroup(client, groupPath) {
    if (groupPath.startsWith('/games/'))
      return this.onLeaveGameGroup(client, groupPath, groupPath.slice(7));
    else if (groupPath.startsWith('/myGames/'))
      return this.onLeaveMyGamesGroup(client, groupPath, groupPath.slice(9));
    else if (groupPath === '/collections' || groupPath.startsWith('/collections/'))
      return this.onLeaveCollectionGroup(client, groupPath, groupPath.slice(13));
    else
      throw new ServerError(404, 'No such group');
  }

  async onJoinGameGroup(client, groupPath, gameId, reference) {
    const game = await this.data.openGame(gameId);
    // Abort if the client is no longer connected.
    if (client.closed) {
      this.data.closeGame(gameId);
      return;
    }

    const firstJoined = !this.gamePara.has(gameId);
    if (firstJoined) {
      // Forward game state and playerRequest events to clients.
      const emit = event => this._emit({
        type: 'event',
        clientId: event.clientId,
        body: {
          group: groupPath,
          type: event.type,
          data: event.data,
        },
      });
      const listener = event => {
        // Send notification, if needed, to the current player
        // Only send a notification after the first playable turn
        // This is because notifications are already sent elsewhere on game start.
        if (event.type === 'startTurn' && event.data.startedAt > game.state.startedAt)
          this._notifyYourTurn(game);

        // Sync clients with the latest game state they may view
        this._emitGameSync(game);
      };

      game.on('playerRequest', emit);
      game.state.on('sync', listener);
      game.state.on('startTurn', listener);

      this.gamePara.set(gameId, {
        playerStatus: new Map(),
        clients: new Map(),
        listener,
        emit,
      });
    }

    const clientPara = this.clientPara.get(client.id);
    clientPara.joinedGroups.add(groupPath);

    const playerId = clientPara.playerId;
    const playerPara = this.playerPara.get(playerId);
    if (playerPara.joinedGameGroups.has(gameId))
      playerPara.joinedGameGroups.get(gameId).add(client.id);
    else
      playerPara.joinedGameGroups.set(gameId, new Set([client.id]));

    const gamePara = this.gamePara.get(gameId);
    const sync = game.getSyncForPlayer(playerId, reference);
    gamePara.clients.set(client.id, sync.reference ?? reference);

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: playerId,
          name: clientPara.name,
        },
      },
    });

    const team = game.getTeamForPlayer(playerId);
    if (team) {
      game.checkin(team);
      this._setGamePlayersStatus(gameId);
      this._watchClientIdleForGame(gameId, client);
    } else if (firstJoined)
      this._setGamePlayersStatus(gameId);

    const response = {
      playerStatus: [...gamePara.playerStatus]
        .map(([playerId, playerStatus]) => ({ playerId, ...playerStatus })),
      sync,
    };

    return response;
  }
  async onJoinMyGamesGroup(client, groupPath, playerId, params) {
    const clientPara = this.clientPara.get(client.id);
    const player = clientPara.player;
    if (playerId !== player.id)
      throw new ServerError(403, 'You may not join other player game groups');

    const playerPara = this.playerPara.get(playerId);

    if (!playerPara.myGames) {
      const myGames = playerPara.myGames = {
        clientIds: new Set(),
      };
      const playerGames = await this.data.openPlayerGames(playerId);
      const stats = myGames.stats = await this._getGameSummaryListStats(playerGames);
      const emit = event => this._emit({
        type: 'event',
        body: {
          group: groupPath,
          type: event.type,
          data: event.data,
        },
      });

      playerGames.on('change', myGames.changeListener = async event => {
        if (event.type === 'change:set') {
          if (event.data.oldSummary)
            emit({ type: 'change', data: event.data.gameSummary });
          else
            emit({ type: 'add', data: event.data.gameSummary });
        } else if (event.type === 'change:delete')
          emit({ type: 'remove', data: event.data.oldSummary });

        const newStats = await this._getGameSummaryListStats(playerGames);
        if (newStats.waiting !== stats.waiting || newStats.active !== stats.active)
          emit({ type: 'stats', data: Object.assign(stats, newStats) });
      });
    }

    const myGames = playerPara.myGames;
    myGames.clientIds.add(client.id);

    const response = {
      stats: myGames.stats,
    };
    if (params.query)
      response.results = await this.data.searchPlayerGames(player, params.query);

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: playerId,
          name: clientPara.name,
        },
      },
    });

    return response;
  }
  async onJoinCollectionGroup(client, groupPath, collectionId, params = {}) {
    const collectionGroups = this.collectionGroups;
    const collectionIds = [];

    if (groupPath === '/collections')
      collectionIds.push(...this.collections.keys());
    else if (collectionGroups.has(collectionId))
      collectionIds.push(...collectionGroups.get(collectionId));
    else
      throw new ServerError(404, 'No such collection');

    const collections = await Promise.all(
      collectionIds.map(cId => this.data.openGameCollection(cId))
    );
    // Abort if the client is no longer connected.
    if (client.closed) {
      for (const cId of collectionIds) {
        this.data.closeGameCollection(cId);
      }
      return;
    }

    const clientPara = this.clientPara.get(client.id);
    const player = clientPara.player;

    for (const collection of collections) {
      if (!this.collectionPara.has(collection.id)) {
        const collectionGroup = `/collections/${collection.id}`;
        const emit = event => this._emit({
          type: 'event',
          body: {
            group: collectionGroup,
            type: event.type,
            data: event.data,
          },
        });
        const changeListener = event => {
          this._emitCollectionChange(collectionGroup, collection, event);
          this._emitCollectionStats(collectionGroup, collection);
        };

        collection.on('change', changeListener);

        this.collectionPara.set(collection.id, {
          clientIds: new Map(),
          stats: new Map(),
          changeListener,
        });
      }

      const collectionPara = this.collectionPara.get(collection.id);

      const clientIds = collectionPara.clientIds;
      if (clientIds.has(client.id))
        clientIds.set(client.id, clientIds.get(client.id) + 1);
      else
        clientIds.set(client.id, 1);

      const stats = collectionPara.stats;
      if (!stats.has(player))
        stats.set(player, await this._getGameSummaryListStats(collection, player));
    }

    clientPara.joinedGroups.add(groupPath);

    const response = {};
    if (params.query)
      if (this.collections.has(collectionId))
        response.results = await this._searchGameCollection(player, collectionId, params.query);
      else
        throw new ServerError(400, 'Can not query collection stats');

    response.stats = new Map();
    for (const cId of collectionIds) {
      response.stats.set(cId, this.collectionPara.get(cId).stats.get(player));
    }

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: player.id,
          name: clientPara.name,
        },
      },
    });

    return response;
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  async _createGame(game) {
    await this.data.createGame(game);
    this._attachGame(game);
    if (game.state.startedAt)
      await this._recordGameStats(game);
    return game;
  }
  async _getGames(gameId) {
    const games = await this.data.getGames(gameId);
    games.forEach(g => this._attachGame(g));
    return games;
  }
  async _getGame(gameId) {
    const game = await this.data.getGame(gameId);
    this._attachGame(game);
    return game;
  }

  _attachGame(game) {
    if (this.attachedGames.has(game))
      return;
    this.attachedGames.add(game);

    const state = this.data.state;

    if (!game.state.startedAt) {
      game.state.once('startGame', event => this._recordGameStats(game));

      if (game.collection && game.state.timeLimit.base < 86400) {
        state.autoCancel.open(game.id, true);
        game.state.once('startGame', event => {
          state.autoCancel.delete(game.id);
        });
        game.on('delete', event => {
          state.autoCancel.delete(game.id);
        });
      }
    }

    if (!game.state.endedAt)
      game.state.once('endGame', event => this._recordGameStats(game));

    this._syncAutoSurrender(game);

    game.state.on('sync', event => {
      this._syncAutoSurrender(game);
    });
    game.state.on('willSync', ({ data:expireIn }) => {
      state.willSync.add(game.id, true, expireIn);
    });
    game.state.on('sync', event => {
      state.willSync.delete(game.id);
    });
    game.on('delete', event => {
      this.data.deleteGame(game);
    });
  }
  async _recordGameStats(game) {
    const playerIds = Array.from(new Set([ ...game.state.teams.map(t => t.playerId) ]));
    const [ players, playersStats ] = await Promise.all([
      Promise.all(playerIds.map(pId => this._getAuthPlayer(pId))),
      Promise.all(playerIds.map(pId => this.data.getPlayerStats(pId))),
    ]);
    const playersMap = new Map(players.map(p => [ p.id, p ]));
    const playersStatsMap = new Map(playersStats.map(ps => [ ps.playerId, ps ]));

    if (game.state.endedAt) {
      if (PlayerStats.updateRatings(game, playersStatsMap))
        for (const playerStats of playersStats)
          playersMap.get(playerStats.playerId).identity.setRanking(playerStats.playerId, playerStats.ratings);

      for (const playerStats of playersStats)
        playerStats.recordGameEnd(game);
    } else {
      for (const playerStats of playersStats)
        playerStats.recordGameStart(game);
    }
  }
  _syncAutoSurrender(game) {
    if (!game.state.startedAt || !game.state.autoSurrender)
      return;

    if (game.state.endedAt)
      this.data.state.autoSurrender.delete(game.id);
    else
      this.data.state.autoSurrender.add(game.id, true, game.state.getTurnTimeRemaining());
  }

  /*
   * This is triggered by player checkin / checkout events.
   * On checkin, open games will not be auto cancelled.
   * On checkout, open games will auto cancel after a period of time.
   * That period of time is 1 hour if they have push notifications enabled.
   * Otherwise, the period of time is based on game turn time limit.
   */
  async _closeAutoCancel(playerId, extended = false) {
    const autoCancel = this.data.state.autoCancel;
    for (const game of await this._getGames(autoCancel.openedKeys()))
      if (game.createdBy === playerId)
        autoCancel.close(game.id, (extended ? 3600 : game.state.timeLimit.initial) * 1000);
  }
  async _reopenAutoCancel(playerId) {
    const autoCancel = this.data.state.autoCancel;
    for (const game of await this._getGames(autoCancel.closedKeys()))
      if (game.createdBy === playerId)
        autoCancel.open(game.id, true);
  }

  async _validateCreateGameForCollection(gameTypeId, gameOptions) {
    /*
     * Validate collection existance.
     */
    const collection = this.collections.get(gameOptions.collection);
    if (!collection)
      throw new ServerError(400, 'Unrecognized game collection');

    /*
     * Validate collection game type
     */
    if (collection.gameType) {
      if (collection.gameType !== gameTypeId)
        throw new ServerError(403, 'Game type is not allowed for this collection');
    }

    /*
     * Validate collection game options
     */
    if (collection.gameOptions) {
      if (collection.gameOptions.defaults)
        for (const key of Object.keys(collection.gameOptions.defaults)) {
          if (gameOptions[key] === undefined)
            gameOptions[key] = collection.gameOptions.defaults[key];
        }

      try {
        collection.gameOptions.validate?.(gameOptions);
      } catch (e) {
        if (e.constructor === Array) {
          // User-facing validation errors are treated manually with specific messages.
          // So, be verbose since failures indicate a problem with the schema or client.
          console.error('data', JSON.stringify({ type: messageType, body }, null, 2));
          console.error('errors', e);
          e = new ServerError(403, 'Game options are not allowed for this collection');
        }

        throw e;
      }
    }

    const playerIds = new Set(gameOptions.teams.filter(t => t?.playerId).map(t => t.playerId));
    await Promise.all([...playerIds].map(pId => this._validateJoinGameForCollection(pId, collection)));
  }
  async _validateJoinGameForCollection(playerId, collection) {
    const collectionGroups = this.collectionGroups;

    /*
     * Validate game limits
     */
    let node = collection;
    while (node) {
      if (node.numPendingGamesPerPlayer) {
        const gameCollections = await Promise.all(
          collectionGroups.get(node.name).map(cId => this.data.getGameCollection(cId))
        );

        let count = 0;
        for (const gameCollection of gameCollections) {
          for (const gameSummary of gameCollection.values()) {
            if (gameSummary.endedAt)
              continue;
            if (gameSummary.teams.findIndex(t => t?.playerId === playerId) === -1)
              continue;

            count++;
            if (count === node.numPendingGamesPerPlayer)
              throw new ServerError(409, 'Too many pending games for this collection');
          }
        }
      }

      node = node.parent;
    }
  }
  async _getGameSummaryListStats(collection, player = null) {
    const stats = { waiting: 0, active: 0 };

    for (const gameSummary of collection.values()) {
      if (!gameSummary.startedAt) {
        if (player) {
          const creator = await this._getAuthPlayer(gameSummary.createdBy);
          if (creator.hasBlocked(player, false))
            continue;
        }
        stats.waiting++;
      } else if (!gameSummary.endedAt)
        stats.active++;
    }

    return stats;
  }
  _emitGameSync(game) {
    const gamePara = this.gamePara.get(game.id);

    for (const [clientId, reference] of gamePara.clients.entries()) {
      const clientPara = this.clientPara.get(clientId);
      const sync = game.getSyncForPlayer(clientPara.playerId, reference);
      if (!sync.reference)
        continue;

      // playerRequest is synced elsewhere
      delete sync.playerRequest;

      gamePara.clients.set(clientId, sync.reference);
      gamePara.emit({ clientId, type: 'sync', data: sync });
    }
  }
  async _emitCollectionChange(collectionGroup, collection, event) {
    const collectionPara = this.collectionPara.get(collection.id);
    const gameSummary = serializer.clone(event.data.gameSummary ?? event.data.oldSummary);
    const eventType = event.type === 'change:delete'
      ? 'remove'
      : event.data.oldSummary ? 'change' : 'add';
    const emitChange = playerId => this._emit({
      type: 'event',
      userId: playerId,
      body: {
        group: collectionGroup,
        type: eventType,
        data: gameSummary,
      },
    });

    for (const player of collectionPara.stats.keys()) {
      const creator = await this._getAuthPlayer(gameSummary.createdBy);
      if (!gameSummary.startedAt && creator.hasBlocked(player, false))
        continue;

      gameSummary.creatorACL = player.getRelationship(creator);

      emitChange(player.id);
    }
  }
  /*
   * When a given collection changes, report stats changes, if any.
   */
  async _emitCollectionStats(collectionGroup, collection) {
    const collectionPara = this.collectionPara.get(collection.id);
    const emitStats = (userId, group, data) => this._emit({
      type: 'event',
      userId,
      body: {
        group,
        type: 'stats',
        data,
      },
    });

    for (const [player, oldStats] of collectionPara.stats) {
      const stats = await this._getGameSummaryListStats(collection, player);
      if (stats.waiting === oldStats.waiting && stats.active === oldStats.active)
        continue;

      collectionPara.stats.set(player, stats);

      const parts = collectionGroup.split('/');
      for (let i = 1; i < parts.length; i++) {
        const group = parts.slice(0, i + 1).join('/');

        emitStats(player.id, group, { collectionId: collection.id, stats });
      }
    }
  }

  /*
   * No longer send change events to the client about this game.
   * Only called internally since the client does not yet leave intentionally.
   */
  onLeaveGameGroup(client, groupPath, gameId) {
    const game = this.data.closeGame(gameId);

    const clientPara = this.clientPara.get(client.id);
    clientPara.joinedGroups.delete(groupPath);

    const gamePara = this.gamePara.get(gameId);
    gamePara.clients.delete(client.id);
    if (gamePara.clients.size === 0) {
      // TODO: Don't shut down the game state until all bots have made their turns.
      game.state.off('sync', gamePara.listener);
      game.state.off('startTurn', gamePara.listener);
      game.off('playerRequest', gamePara.emit);

      this.gamePara.delete(gameId);
    }

    const playerId = clientPara.playerId;
    const playerPara = this.playerPara.get(playerId);
    const watchingClientIds = playerPara.joinedGameGroups.get(gameId);

    if (watchingClientIds.size === 1)
      playerPara.joinedGameGroups.delete(gameId);
    else
      watchingClientIds.delete(client.id);

    const team = game.getTeamForPlayer(playerId);
    if (team) {
      // If the client is closed, hold off on updating status.
      if (!client.closed && gamePara.clients.size > 0)
        this._setGamePlayersStatus(gameId);

      const checkoutAt = new Date();
      const lastActiveAt = new Date(checkoutAt - client.session.idle * 1000);
      game.checkout(team, checkoutAt, lastActiveAt);

      this._unwatchClientIdleForGame(gameId, client);
    }

    this._emit({
      type: 'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: playerId,
          name: clientPara.name,
        },
      },
    });
  }
  onLeaveMyGamesGroup(client, groupPath, playerId) {
    const clientPara = this.clientPara.get(client.id);
    const playerPara = this.playerPara.get(playerId);
    const myGames = playerPara.myGames;

    myGames.clientIds.delete(client.id);

    if (myGames.clientIds.size === 0) {
      const playerGames = this.data.closePlayerGames(playerId);

      playerGames.off('change', myGames.changeListener);

      delete playerPara.myGames;
    }

    this._emit({
      type: 'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: playerId,
          name: clientPara.name,
        },
      },
    });
  }
  onLeaveCollectionGroup(client, groupPath, collectionId) {
    const collectionGroups = this.collectionGroups;
    const collectionIds = [];

    if (groupPath === '/collections')
      collectionIds.push(...this.collections.keys());
    else if (collectionGroups.has(collectionId))
      collectionIds.push(...collectionGroups.get(collectionId));
    else
      throw new ServerError(404, 'No such collection');

    const collections = collectionIds.map(cId => this.data.closeGameCollection(cId));

    const clientPara = this.clientPara.get(client.id);
    clientPara.joinedGroups.delete(groupPath);

    for (const collection of collections) {
      const collectionPara = this.collectionPara.get(collection.id);
      const clientIds = collectionPara.clientIds;
      const joinCount = clientIds.get(client.id);
      if (joinCount > 1)
        clientIds.set(client.id, joinCount - 1);
      else {
        clientIds.delete(client.id);

        if (clientIds.size === 0) {
          collection.off('change', collectionPara.changeListener);

          this.collectionPara.delete(collection.id);
        }
      }
    }

    this._emit({
      type: 'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: clientPara.playerId,
          name: clientPara.name,
        },
      },
    });
  }

  onActionRequest(client, groupPath, action) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const clientPara = this.clientPara.get(client.id);
    if (!clientPara.joinedGroups.has(groupPath))
      throw new ServerError(412, 'You must first join the game group');

    const playerId = clientPara.playerId;
    const game = this.data.getOpenGame(gameId);

    game.submitAction(playerId, action);
  }
  onPlayerRequestRequest(client, groupPath, requestType, receivedAt) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const clientPara = this.clientPara.get(client.id);
    if (!clientPara.joinedGroups.has(groupPath))
      throw new ServerError(412, 'You must first join the game group');

    const playerId = clientPara.playerId;
    const game = this.data.getOpenGame(gameId);

    game.submitPlayerRequest(playerId, requestType, receivedAt);
  }

  onPlayerRequestAcceptEvent(client, groupPath, createdAt) {
    const playerId = this.clientPara.get(client.id).playerId;
    const gameId = groupPath.replace(/^\/games\//, '');
    const game = this.data.getOpenGame(gameId);

    game.acceptPlayerRequest(playerId, createdAt);
  }
  onPlayerRequestRejectEvent(client, groupPath, createdAt) {
    const playerId = this.clientPara.get(client.id).playerId;
    const gameId = groupPath.replace(/^\/games\//, '');
    const game = this.data.getOpenGame(gameId);

    game.rejectPlayerRequest(playerId, createdAt);
  }
  onPlayerRequestCancelEvent(client, groupPath, createdAt) {
    const playerId = this.clientPara.get(client.id).playerId;
    const gameId = groupPath.replace(/^\/games\//, '');
    const game = this.data.getOpenGame(gameId);

    game.cancelPlayerRequest(playerId, createdAt);
  }

  /*******************************************************************************
   * Helpers
   ******************************************************************************/
  async _getAuthPlayer(playerId) {
    if (this.playerPara.has(playerId))
      return this.playerPara.get(playerId).player;
    else
      return this.auth.getPlayer(playerId);
  }
  async _searchGameCollection(player, collectionId, query) {
    return this.data.searchGameCollection(player, collectionId, query, this._getAuthPlayer.bind(this));
  }

  _resolveTeamSet(gameType, game, team) {
    const firstTeam = game.state.teams.filter(t => t?.joinedAt).sort((a, b) => a.joinedAt < b.joinedAt)[0];

    if (!gameType.isCustomizable || team.set === null) {
      const set = gameType.getDefaultSet();
      team.set = { units: set.units };
    } else if (team.set === 'same') {
      if (!firstTeam)
        throw new ServerError(400, `Can't use same set when nobody has joined yet.`);
      team.set = {
        via: 'same',
        ...firstTeam.set.clone(),
      };
    } else if (team.set === 'mirror') {
      if (!firstTeam)
        throw new ServerError(400, `Can't use mirror set when nobody has joined yet.`);
      team.set = {
        via: 'mirror',
        units: firstTeam.set.units.map(u => {
          const unit = { ...u };
          unit.assignment = [...unit.assignment];
          unit.assignment[0] = 10 - unit.assignment[0];
          if (unit.direction === 'W')
            unit.direction = 'E';
          else if (unit.direction === 'E')
            unit.direction = 'W';
          return unit;
        }),
      };
    } else if (team.set === 'random') {
      const set = this.data.getOpenPlayerSets(team.playerId, gameType).random();
      team.set = {
        via: 'random',
        units: JSON.clone(set.units),
      };
    } else if (typeof team.set === 'string') {
      const set = this.data.getOpenPlayerSet(team.playerId, gameType, team.set);
      if (set === null)
        throw new ServerError(412, 'Sorry!  Looks like the selected set no longer exists.');
      team.set = { units:JSON.clone(set.units) };
    }
  }
  async _joinGame(game, gameType, team) {
    this._resolveTeamSet(gameType, game, team);

    game.state.join(team);

    const teams = game.state.teams;

    if (teams.findIndex(t => !t?.joinedAt) === -1) {
      const playerIds = new Set(teams.map(t => t.playerId));
      if (playerIds.size > 1) {
        if (game.state.rated) {
          const players = await Promise.all([ ...playerIds ].map(pId => this._getAuthPlayer(pId)));
          const { ranked, reason } = await this.data.canPlayRankedGame(game, ...players);
          game.state.ranked = ranked;
          game.state.unrankedReason = reason;
        }

        await this.chat.createRoom(
          teams.map(t => ({ id: t.playerId, name: t.name })),
          { id: game.id, applyRules: !!game.collection }
        );
      }

      // Now that the chat room is created, start the game.
      game.state.start();
    }
  }

  _setGamePlayersStatus(gameId) {
    const game = this.data.getOpenGame(gameId);
    const { playerStatus, emit } = this.gamePara.get(gameId);
    const teamPlayerIds = new Set(game.state.teams.filter(t => t?.joinedAt).map(t => t.playerId));

    /*
     * Prune player IDs that have left the game.
     * Possible for 4-player games that haven't started yet.
     */
    for (const playerId of playerStatus.keys()) {
      if (!teamPlayerIds.has(playerId))
        playerStatus.delete(playerId);
    }

    for (const playerId of teamPlayerIds) {
      const oldPlayerStatus = playerStatus.get(playerId);
      const newPlayerStatus = this._getPlayerGameStatus(playerId, game);
      if (
        newPlayerStatus.status !== oldPlayerStatus?.status ||
        newPlayerStatus.deviceType !== oldPlayerStatus?.deviceType
      ) {
        playerStatus.set(playerId, newPlayerStatus);
        if (oldPlayerStatus !== undefined)
          emit({
            type: 'playerStatus',
            data: { playerId, ...newPlayerStatus },
          });
      }
    }
  }
  _setPlayerGamesStatus(playerId) {
    for (const game of this.data.getOpenGames()) {
      if (!game.state.teams.find(t => t?.playerId === playerId))
        continue;

      this._setGamePlayersStatus(game.id);
    }
  }
  _watchClientIdleForGame(gameId, client) {
    const session = client.session;

    if (session.watchers)
      session.watchers.add(gameId);
    else {
      session.watchers = new Set([gameId]);
      session.onIdleChange = this.idleWatcher;
    }
  }
  _unwatchClientIdleForGame(gameId, client) {
    const session = client.session;

    if (session.watchers.size > 1)
      session.watchers.delete(gameId);
    else {
      delete session.watchers;
      delete session.onIdleChange;
    }
  }
  _getPlayerGameStatus(playerId, game) {
    const playerPara = this.playerPara.get(playerId);
    if (!playerPara || (game.state.endedAt && !playerPara.joinedGameGroups.has(game.id)))
      return { status: 'offline' };

    let deviceType;
    for (const clientId of playerPara.clients) {
      const clientPara = this.clientPara.get(clientId);
      if (clientPara.deviceType !== 'mobile')
        continue;

      deviceType = 'mobile';
      break;
    }

    if (!playerPara.joinedGameGroups.has(game.id))
      return { status: 'online', deviceType };

    /*
     * Determine active status with the minimum idle of all clients this player
     * has connected to this game.
     */
    const clientIds = [...playerPara.joinedGameGroups.get(game.id)];
    const idle = Math.min(
      ...clientIds.map(cId => this.clientPara.get(cId).client.session.idle)
    );

    return {
      status: idle > ACTIVE_LIMIT ? 'online' : 'active',
      deviceType,
      isOpen: true,
    };
  }
  /*
   * There is a tricky thing here.  It is possible that a player checked in with
   * multiple clients, but the most recently active client checked out first.
   * In that case, show the idle time based on the checked out client rather
   * than the longer idle times of client(s) still checked in.
   */
  async _getPlayerIdle(playerId) {
    const player = await this._getAuthPlayer(playerId);
    const idle = Math.floor((new Date() - player.checkoutAt) / 1000);

    const playerPara = this.playerPara.get(playerId);
    if (playerPara) {
      const clientIds = [...playerPara.clients];
      return Math.min(
        ...clientIds.map(cId => this.clientPara.get(cId).client.session.idle),
        idle,
      );
    }

    return idle;
  }
  _getPlayerGameIdle(playerId, game) {
    const team = game.state.teams.find(t => t.playerId === playerId);
    const gameIdle = Math.floor((new Date() - (team.lastActiveAt ?? team.joinedAt)) / 1000);

    const playerPara = this.playerPara.get(playerId);
    if (playerPara && playerPara.joinedGameGroups.has(game.id)) {
      const clientIds = [...playerPara.joinedGameGroups.get(game.id)];
      return Math.min(
        ...clientIds.map(cId => this.clientPara.get(cId).client.session.idle),
        gameIdle,
      );
    }

    return gameIdle;
  }
  async _getPlayerActivity(playerId, fromGameId, inPlayerId) {
    // The player must be online
    const playerPara = this.playerPara.get(playerId);
    if (!playerPara)
      return;

    // Get a list of games in which the player is participating and has opened.
    // Sort the games from most active to least.
    const openGamesInfo = [...playerPara.joinedGameGroups.keys()]
      .map(gameId => this.data.getOpenGame(gameId))
      .filter(game =>
        game.state.startedAt && !game.state.endedAt &&
        game.state.teams.findIndex(t => t.playerId === playerId) > -1
      )
      .map(game => ({ game, idle: this._getPlayerGameIdle(playerId, game) }))
      .sort((a, b) => a.idle - b.idle);

    // Get a filtered list of the games that are active.
    const activeGamesInfo = openGamesInfo
      .filter(agi => agi.idle <= ACTIVE_LIMIT)

    const activity = {
      activeGamesCount: activeGamesInfo.length,
      inactiveGamesCount: openGamesInfo.length - activeGamesInfo.length,
    };

    for (const { game } of openGamesInfo) {
      if (game.forkOf?.gameId !== game.id) continue;

      activity.forkGameId = game.id;
      break;
    }

    // Only interested in games where all participants are actively playing.
    const activeGamesOfInterest = [];
    for (const { game } of activeGamesInfo) {
      if (game.id === fromGameId) continue;

      // Only collect public or lobby games
      if (!game.collection)
        continue;

      // Only collect games where all participants are active
      const playerIds = new Set(game.state.teams.map(t => t.playerId));
      const inactivePlayerId = [...playerIds].find(pId =>
        pId !== inPlayerId &&
        this._getPlayerGameIdle(pId, game) > ACTIVE_LIMIT
      );
      if (inactivePlayerId) continue;

      if (playerIds.has(inPlayerId)) {
        activity.yourGameId = game.id;
        activeGamesOfInterest.length = 0;
        break;
      }

      activeGamesOfInterest.push(game);
    }

    // Only allow access to an active game if they are using a name you have seen before.
    if (activeGamesOfInterest.length === 1) {
      const activeGame = activeGamesOfInterest[0];
      const playerTeamName = activeGame.state.teams.find(t => t.playerId === playerId).name;
      const aliases = await this.data.listPlayerAliases(inPlayerId, playerId);
      if (aliases.has(playerTeamName.toLowerCase()))
        activity.activeGameId = activeGame.id;
    }

    return activity;
  }

  async _notifyYourTurn(game) {
    const teams = game.state.teams;
    const playerId = game.state.currentTeam.playerId;

    // Only notify if the current player is not already in-game.
    // Still notify if the current player is in-game, but inactive?
    const playerPara = this.playerPara.get(playerId);
    if (playerPara && playerPara.joinedGameGroups.has(game.id))
      return;

    const notification = await this.getYourTurnNotification(playerId);
    // Game count should always be >= 1, but just in case...
    if (notification.gameCount === 0)
      return;

    const urgency = game.state.rated === true && game.state.timeLimit.base < 86400 ? 'high' : 'normal';

    this.push.pushNotification(playerId, notification, urgency);
  }
}
