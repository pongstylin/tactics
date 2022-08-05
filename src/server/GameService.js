import uaparser from 'ua-parser-js';
import util from 'util';

import setsById from 'config/sets.js';
import AccessToken from 'server/AccessToken.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import Game from 'models/Game.js';
import Team from 'models/Team.js';
import Player from 'models/Player.js';
import serializer, { unionType } from 'utils/serializer.js';

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
      authorize: { token:AccessToken },
      requests: {
        createGame: [ 'string', 'game:options' ],
        tagGame: [ 'uuid', 'game:tags' ],
        forkGame: [ 'uuid', 'game:forkOptions' ],
        cancelGame: [ 'uuid' ],
        joinGame: `tuple([ 'uuid', 'game:joinTeam' ], 1)`,

        getGameTypeConfig: [ 'string' ],
        getGame: [ 'uuid' ],
        getTurnData: [ 'uuid', 'integer(0)' ],
        getTurnActions: [ 'uuid', 'integer(0)' ],

        action: [ 'game:group', 'game:newAction | game:newAction[]' ],
        playerRequest: [ 'game:group', `enum(['undo','truce'])` ],
        getPlayerStatus: [ 'game:group' ],
        getPlayerActivity: [ 'game:group', 'uuid' ],
        getPlayerInfo: [ 'game:group', 'uuid' ],
        clearWLDStatsRequest: `tuple([ 'uuid', 'string | null' ], 1)`,

        searchGameCollection: [ 'string', 'any' ],
        searchMyGames: [ 'any' ],

        getPlayerSets: [ 'string' ],
        hasCustomPlayerSet: [ 'string', 'string' ],
        getPlayerSet: [ 'string', 'string' ],
        savePlayerSet: [ 'string', 'game:set' ],
        deletePlayerSet: [ 'string', 'string' ],

        getMyAvatar: [],
        saveMyAvatar: [ 'game:avatar' ],
        getMyAvatarList: [],
        getPlayersAvatar: [ 'uuid[]' ],
      },
      events: {
        'playerRequest:accept': [ 'game:group', 'Date' ],
        'playerRequest:reject': [ 'game:group', 'Date' ],
        'playerRequest:cancel': [ 'game:group', 'Date' ],
      },
      definitions: {
        group: 'string(/^\\/games\\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/)',
        coords: [ 'integer(0,10)', 'integer(0,10)' ],
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
          `enum([ 'same', 'mirror', 'random', '${[ ...setsById.keys() ].join("','")}' ])`,
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
          'turnTimeLimit?': `enum([ 'blitz', 'standard', 86400, 604800 ])`,
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
    else
      this.playerPara.delete(playerId);

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
    for (let i=1; i<teams.length; i++) {
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
      ]).then(([ player ]) => clientPara.player = player);
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

    if (!gameOptions.rated && gameOptions.strictUndo)
      throw new ServerError(400, 'Strict undo may only be enabled in rated games');

    const isMultiplayer = gameOptions.teams.findIndex(t => t?.playerId !== playerId) > -1;
    if (gameOptions.rated && !isMultiplayer)
      throw new ServerError(400, 'Practice games can\'t be rated');

    gameOptions.createdBy = playerId;
    gameOptions.type = gameTypeId;

    if (gameOptions.turnTimeLimit === 'standard') {
      gameOptions.turnTimeLimit = 120;
      gameOptions.turnTimeBuffer = 300;
    } else if (gameOptions.turnTimeLimit === 'blitz') {
      gameOptions.turnTimeLimit = 30;
      gameOptions.turnTimeBuffer = 120;
      if (gameOptions.rated)
        gameOptions.strictUndo = true;
    } else if (gameOptions.turnTimeLimit === undefined) {
      if (isMultiplayer)
        stateData.turnTimeLimit = 604800;
    }

    const game = Game.create({
      ...gameOptions,
      teams: new Array(gameOptions.teams.length).fill(null),
    });
    const gameType = this.data.getGameType(gameTypeId);

    for (const [slot, teamData] of gameOptions.teams.entries()) {
      if (!teamData) continue;

      teamData.slot = slot;

      let team;
      if (teamData.playerId && teamData.playerId !== playerId) {
        const player = await this._getAuthPlayer(teamData.playerId);
        if (!player)
          throw new ServerError(404, 'A team has an unrecognized player ID');

        team = Team.createReserve(teamData, clientPara);
      } else if (teamData.set === undefined && gameType.isCustomizable) {
        team = Team.createReserve(teamData, clientPara);
      } else {
        if (teamData.name !== undefined)
          Player.validatePlayerName(teamData.name);

        team = Team.createJoin(teamData, clientPara, game, gameType);
      }

      await this._joinGame(game, gameType, team);
    }

    // Create the game before generating a notification to ensure it is accurate.
    await this.data.createGame(game);

    /*
     * Notify the player that goes first that it is their turn.
     * ...unless the player to go first just created the game.
     */
    if (game.state.startedAt) {
      if (game.state.currentTeam.playerId !== playerId)
        this._notifyYourTurn(game);
    }

    return game.id;
  }
  async onTagGameRequest(client, gameId, tags) {
    const clientPara = this.clientPara.get(client.id);
    const game = await this.data.getGame(gameId);

    if (game.createdBy !== clientPara.playerId)
      throw new ServerError(403, `May not tag someone else's game`);

    game.mergeTags(tags);
  }

  async onForkGameRequest(client, gameId, options) {
    this.debug(`forkGame: gameId=${gameId}; turnId=${options.turnId}, vs=${options.vs}, as=${options.as}`);

    const clientPara = this.clientPara.get(client.id);
    const game = await this.data.getGame(gameId);
    const newGame = game.fork(clientPara, options);

    await this.data.createGame(newGame);

    return newGame.id;
  }

  async onJoinGameRequest(client, gameId, teamData = {}) {
    this.debug(`joinGame: gameId=${gameId}`);

    if (teamData.name !== undefined && teamData.name !== null)
      Player.validatePlayerName(teamData.name);

    const clientPara = this.clientPara.get(client.id);
    const playerId = clientPara.playerId;
    const game = await this.data.getGame(gameId);
    if (game.state.startedAt)
      throw new ServerError(409, 'The game has already started.');

    if (game.collection)
      await this._validateJoinGameForCollection(playerId, this.collections.get(game.collection));

    const creator = await this._getAuthPlayer(game.createdBy);
    if (creator.hasBlocked(playerId))
      throw new ServerError(403, 'You are blocked from joining this game.');

    /*
     * You can't play a blocked player.  But you can downgrade them to muted first.
     */
    if (creator.isBlockedBy(playerId)) {
      const joiner = await this._getAuthPlayer(playerId);
      const playerACL = joiner.getPlayerACL(creator.id);
      if (playerACL && playerACL.type === 'blocked')
        joiner.mute(creator, playerACL.name);
    }

    const gameType = this.data.getGameType(game.state.type);
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
    if (game.state.startedAt) {
      if (game.state.currentTeam.playerId !== playerId)
        this._notifyYourTurn(game);
    }
  }

  async onCancelGameRequest(client, gameId) {
    this.debug(`cancelGame: gameId=${gameId}`);

    const clientPara = this.clientPara.get(client.id);
    const game = await this.data.getGame(gameId);
    if (clientPara.playerId !== game.createdBy)
      throw new ServerError(403, 'You cannot cancel other users\' game');

    const gamePara = this.gamePara.get(gameId);
    if (gamePara) {
      for (const clientId of gamePara.clients.keys()) {
        this.onLeaveGameGroup(this.clientPara.get(clientId).client, `/games/${gameId}`, gameId);
      }
    }

    game.cancel();
  }

  async onGetGameTypeConfigRequest(client, gameTypeId) {
    return this.data.getGameType(gameTypeId);
  }

  async onGetPlayerSetsRequest(client, gameTypeId) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.getPlayerSets(clientPara.playerId, gameTypeId);
  }
  async onHasCustomPlayerSetRequest(client, gameTypeId, setId) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.hasCustomPlayerSet(clientPara.playerId, gameTypeId, setId);
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
    const game = await this.data.getGame(gameId);
    const gameData = game.toJSON();
    gameData.state = gameData.state.getDataForPlayer(clientPara?.playerId);

    return gameData;
  }
  async onGetTurnDataRequest(client, gameId, ...args) {
    this.throttle(client.address, 'getTurnData', 300, 300);

    const game = await this.data.getGame(gameId);

    return game.state.getTurnData(...args);
  }
  async onGetTurnActionsRequest(client, gameId, ...args) {
    this.throttle(client.address, 'getTurnData', 300, 300);

    const game = await this.data.getGame(gameId);

    return game.state.getTurnActions(...args);
  }

  async onGetPlayerStatusRequest(client, groupPath) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const clientPara = this.clientPara.get(client.id);
    if (!clientPara.joinedGroups.has(groupPath))
      throw new ServerError(412, 'To get player status for this game, you must first join it');

    const gamePara = this.gamePara.get(gameId);
    return [ ...gamePara.playerStatus ]
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

    const me = await this._getAuthPlayer(inPlayerId);
    const player = await this._getAuthPlayer(forPlayerId);
    const globalStats = await this.data.getPlayerStats(forPlayerId, forPlayerId);
    const localStats = await this.data.getPlayerStats(inPlayerId, forPlayerId);

    return {
      createdAt: player.createdAt,
      completed: globalStats.completed,
      canNotify: await this.push.hasPushSubscription(forPlayerId),
      acl: me.getPlayerACL(forPlayerId),
      stats: {
        aliases: [ ...localStats.aliases.values() ]
          .filter(a => a.name.toLowerCase() !== team.name.toLowerCase())
          .sort((a,b) =>
            b.count - a.count || b.lastSeenAt - a.lastSeenAt
          )
          .slice(0, 10),
        all: localStats.all,
        style: localStats.style.get(game.state.type),
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
    return this.data.searchGameCollection(player, collectionId, query);
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
      this.data.closeGame(game);
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
      const listener = ({ data:event }) => {
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
      playerPara.joinedGameGroups.set(gameId, new Set([ client.id ]));

    const gamePara = this.gamePara.get(gameId);
    const sync = game.getSyncForPlayer(playerId, reference);
    gamePara.clients.set(client.id, sync.reference);

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id:   playerId,
          name: clientPara.name,
        },
      },
    });

    const isPlayer = game.state.teams.findIndex(t => t?.playerId === playerId) > -1;
    if (isPlayer) {
      this._setGamePlayersStatus(gameId);
      this._watchClientIdleForGame(gameId, client);
    } else if (firstJoined)
      this._setGamePlayersStatus(gameId);

    const response = {
      playerStatus: [ ...gamePara.playerStatus ]
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
      const stats = myGames.stats = this._getGameSummaryListStats(playerGames);
      const emit = event => this._emit({
        type: 'event',
        body: {
          group: groupPath,
          type: event.type,
          data: event.data,
        },
      });

      playerGames.on('change', myGames.changeListener = event => {
        if (event.type === 'change:set') {
          if (event.data.oldSummary)
            emit({ type:'change', data:event.data.gameSummary });
          else
            emit({ type:'add', data:event.data.gameSummary });
        } else if (event.type === 'change:delete')
          emit({ type:'remove', data:event.data.oldSummary });

        const newStats = this._getGameSummaryListStats(playerGames);
        if (newStats.waiting !== stats.waiting || newStats.active !== stats.active)
          emit({ type:'stats', data:Object.assign(stats, newStats) });
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
          id:   playerId,
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
        stats.set(player, this._getGameSummaryListStats(collection, player));
    }

    clientPara.joinedGroups.add(groupPath);

    const response = {};
    if (params.query)
      if (this.collections.has(collectionId))
        response.results = await this.data.searchGameCollection(player, collectionId, params.query);
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
          id:   player.id,
          name: clientPara.name,
        },
      },
    });

    return response;
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
      } catch(e) {
        if (e.constructor === Array) {
          // User-facing validation errors are treated manually with specific messages.
          // So, be verbose since failures indicate a problem with the schema or client.
          console.error('data', JSON.stringify({ type:messageType, body }, null, 2));
          console.error('errors', e);
          e = new ServerError(403, 'Game options are not allowed for this collection');
        }

        throw e;
      }
    }

    const playerIds = new Set(gameOptions.teams.filter(t => t?.playerId).map(t => t.playerId));
    await Promise.all([ ...playerIds ].map(pId => this._validateJoinGameForCollection(pId, collection)));
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
  _getGameSummaryListStats(collection, player = null) {
    const stats = { waiting:0, active:0 };

    for (const gameSummary of collection.values()) {
      if (!gameSummary.startedAt) {
        if (!player?.isBlockedBy(gameSummary.createdBy))
          stats.waiting++;
      } else if (!gameSummary.endedAt)
        stats.active++;
    }

    return stats;
  }
  _emitGameSync(game) {
    const gamePara = this.gamePara.get(game.id);

    for (const [ clientId, reference ] of gamePara.clients.entries()) {
      const clientPara = this.clientPara.get(clientId);
      const sync = game.getSyncForPlayer(clientPara.playerId, reference);
      if (!sync.reference)
        continue;

      // playerRequest is synced elsewhere
      delete sync.playerRequest;

      gamePara.clients.set(clientId, sync.reference);
      gamePara.emit({ clientId, type:'sync', data:sync });
    }
  }
  _emitCollectionChange(collectionGroup, collection, event) {
    const collectionPara = this.collectionPara.get(collection.id);
    const gameSummary = event.data.gameSummary ?? event.data.oldSummary;
    const eventType = event.type === 'change:delete'
      ? 'remove'
      : event.data.oldSummary ? 'change' : 'add';
    const emitChange = userId => this._emit({
      type: 'event',
      userId,
      body: {
        group: collectionGroup,
        type: eventType,
        data: gameSummary,
      },
    });

    for (const player of collectionPara.stats.keys()) {
      if (!gameSummary.startedAt && player.isBlockedBy(gameSummary.createdBy))
        continue;

      emitChange(player.id);
    }
  }
  /*
   * When a given collection changes, report stats changes, if any.
   */
  _emitCollectionStats(collectionGroup, collection) {
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

    for (const [ player, oldStats ] of collectionPara.stats) {
      const stats = this._getGameSummaryListStats(collection, player);
      if (stats.waiting === oldStats.waiting && stats.active === oldStats.active)
        continue;

      collectionPara.stats.set(player, stats);

      const parts = collectionGroup.split('/');
      for (let i = 1; i < parts.length; i++) {
        const group = parts.slice(0, i+1).join('/');

        emitStats(player.id, group, { collectionId:collection.id, stats });
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

    const isPlayer = game.state.teams.findIndex(t => t?.playerId === playerId) > -1;
    if (isPlayer) {
      // If the client is closed, hold off on updating status.
      if (!client.closed && gamePara.clients.size > 0)
        this._setGamePlayersStatus(gameId);

      const checkoutAt = new Date(Date.now() - client.session.idle * 1000);
      game.checkout(playerId, checkoutAt);

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
  _getAuthPlayer(playerId) {
    if (this.playerPara.has(playerId))
      return this.playerPara.get(playerId).player;
    else
      return this.auth.getPlayer(playerId);
  }

  /*
   * Designed to be run against the same game multiple times.  This is necessary
   * since sets may need to be resolved every time somebody joins the game.  This
   * ensures that sets are what the player expects at the time the game is created
   * and is not affected by further changing of their sets before game starts.
   */
  async _resolveTeamsSets(game, gameType) {
    const joinedTeams = game.state.teams.filter(t => !!t?.joinedAt).sort((a,b) => a.joinedAt - b.joinedAt);
    const firstTeam = joinedTeams[0];

    const resolve = async team => {
      if (!gameType.isCustomizable || team.set === null) {
        const set = gameType.getDefaultSet();
        team.set = { units:set.units };
      } else if (team.set === 'same') {
        team.set = {
          via: 'same',
          ...firstTeam.set,
        };
      } else if (team.set === 'mirror') {
        team.set = {
          via: 'mirror',
          units: firstTeam.set.units.map(u => {
            const unit = { ...u };
            unit.assignment = [ ...unit.assignment ];
            unit.assignment[0] = 10 - unit.assignment[0];
            if (unit.direction === 'W')
              unit.direction = 'E';
            else if (unit.direction === 'E')
              unit.direction = 'W';
            return unit;
          }),
        };
      } else if (team.set === 'random') {
        const set = (await this.data.getPlayerSets(team.playerId, gameType)).random();
        team.set = {
          via: 'random',
          units: set.units,
        };
      } else if (typeof team.set === 'string') {
        const set = await this.data.getPlayerSet(team.playerId, gameType, team.set);
        team.set = { units:set.units };
      }
    };

    /*
     * Resolve the first team set first since this is used to resolve 'same' and
     * 'mirror' sets after.
     */
    await resolve(firstTeam);
    await Promise.all(joinedTeams.slice(1).map(t => resolve(t)));
  }
  async _joinGame(game, gameType, team) {
    game.state.join(team);

    await this._resolveTeamsSets(game, gameType);

    /*
     * If no open slots remain, start the game.
     */
    const teams = game.state.teams;

    if (teams.findIndex(t => !t?.joinedAt) === -1) {
      const players = new Map(teams.map(t => [ t.playerId, t.name ]));
      if (players.size > 1)
        await this.chat.createRoom(
          [...players].map(([id, name]) => ({ id, name })),
          { id:game.id }
        );

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
        newPlayerStatus.status     !== oldPlayerStatus?.status ||
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
      session.watchers = new Set([ gameId ]);
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
      return { status:'offline' };

    let deviceType;
    for (const clientId of playerPara.clients) {
      const clientPara = this.clientPara.get(clientId);
      if (clientPara.deviceType !== 'mobile')
        continue;

      deviceType = 'mobile';
      break;
    }

    if (!playerPara.joinedGameGroups.has(game.id))
      return { status:'online', deviceType };

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
    const gameIdle = Math.floor((new Date() - (team.checkoutAt ?? game.state.startedAt)) / 1000);

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
      .map(game => ({ game, idle:this._getPlayerGameIdle(playerId, game) }))
      .sort((a,b) => a.idle - b.idle);

    // Get a filtered list of the games that are active.
    const activeGamesInfo = openGamesInfo
      .filter(agi => agi.idle <= ACTIVE_LIMIT)

    const activity = {
      activeGamesCount: activeGamesInfo.length,
      inactiveGamesCount: openGamesInfo.length - activeGamesInfo.length,
    };

    for (const { game } of openGamesInfo) {
      const isPracticeGame = new Set(game.state.teams.map(t => t.playerId)).size === 1;
      if (!isPracticeGame) continue;
      if (game.forkOf?.gameId !== game.id) continue;

      activity.forkGameId = game.id;
      break;
    }

    // Only interested in games where all participants are actively playing.
    const activeGamesOfInterest = [];
    for (const { game } of activeGamesInfo) {
      if (game.id === fromGameId) continue;

      const playerIds = new Set(game.state.teams.map(t => t.playerId));
      const isPracticeGame = playerIds.size === 1;
      if (isPracticeGame) continue;

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

    this.push.pushNotification(playerId, notification);
  }
}
