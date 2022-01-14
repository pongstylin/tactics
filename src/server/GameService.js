import uaparser from 'ua-parser-js';

import AccessToken from 'server/AccessToken.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import Game from 'models/Game.js';
import Team from 'models/Team.js';
import Player from 'models/Player.js';
import { unionType } from 'utils/serializer.js';

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

        hasCustomPlayerSet: [ 'string', 'string' ],
        getPlayerSet: [ 'string', 'string' ],
        savePlayerSet: [ 'string', 'string', 'game:set' ],
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
          units: 'game:newUnit[]',
        },
        setOption: unionType(
          'game:set',
          { name:'string' },
          `enum([ 'same', 'mirror' ])`,
        ),
        newTeam: unionType(
          'null',
          {
            'playerId?': 'uuid',
            'name?': 'string',
            'set?': 'game:setOption',
          },
        ),
        joinTeam: {
          'playerId?': 'uuid',
          'name?': 'string',
          'set?': 'game:setOption',
          'slot?': 'integer(0,4)',
        },
        tags: `dict('string | number | boolean')`,
        options: {
          teams: 'game:newTeam[2] | game:newTeam[4]',
          'collection?': 'string',
          'randomFirstTurn?': 'boolean',
          'randomHitChance?': 'boolean',
          'strictUndo?': 'boolean',
          'autoSurrender?': 'boolean',
          'turnTimeBuffer?': `const(0)`,
          'turnTimeLimit?': 'enum([ 30, 120, 86400, 604800 ])',
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
      },
    });

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
    }
    else
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

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  async onAuthorize(client, { token }) {
    if (this.clientPara.has(client.id)) {
      const clientPara = this.clientPara.get(client.id);
      if (clientPara.playerId !== token.playerId)
        throw new ServerError(501, 'Unsupported change of player');

      clientPara.client = client;
      clientPara.token = token;
      clientPara.name = token.playerName;

      // Just in case a client attempts to authorize twice in parallel.
      await clientPara.playerPromise;
    } else {
      const clientPara = {
        joinedGroups: new Set(),
      };

      const playerId = clientPara.playerId = token.playerId;
      clientPara.client = client;
      clientPara.token = token;
      clientPara.name = token.playerName;
      clientPara.deviceType = uaparser(client.agent).device.type;
      clientPara.playerPromise = this.data.openPlayer(playerId);
      this.clientPara.set(client.id, clientPara);

      const playerPara = this.playerPara.get(playerId);
      if (playerPara)
        // This operation would be redundant if client authorizes more than once.
        playerPara.clients.add(client.id);
      else {
        this.playerPara.set(playerId, {
          player: await this.auth.openPlayer(playerId),
          clients: new Set([client.id]),
          joinedGameGroups: new Map(),
        });

        // Let people who needs to know that this player is online.
        this._setPlayerGamesStatus(playerId);
      }

      await clientPara.playerPromise;
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
    gamePara.clients.forEach(clientPara =>
      clientPara.joinedGroups.delete(`/games/${gameId}`)
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
    this.throttle(playerId, 'createGame');

    if (gameOptions.collection && !this.config.collections.includes(gameOptions.collection))
      throw new ServerError(400, 'Unrecognized game group');

    if (gameOptions.teams.findIndex(t => t?.playerId === playerId && t.set !== undefined) === -1)
      throw new ServerError(400, 'You must join games that you create');

    gameOptions.createdBy = playerId;
    gameOptions.type = gameTypeId;

    const game = Game.create({
      ...gameOptions,
      teams: new Array(gameOptions.teams.length).fill(null),
    });
    const gameType = await this.data.getGameType(gameTypeId);

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
      for (const clientId of gamePara.clients) {
        this.onLeaveGameGroup(this.clientPara.get(clientId).client, `/games/${gameId}`, gameId);
      }
    }

    await this.data.cancelGame(game);
  }

  async onGetGameTypeConfigRequest(client, gameTypeId) {
    return this.data.getGameType(gameTypeId);
  }

  async onHasCustomPlayerSetRequest(client, gameTypeId, setName) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.hasCustomPlayerSet(clientPara.playerId, gameTypeId, setName);
  }
  async onGetPlayerSetRequest(client, gameTypeId, setName) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.getPlayerSet(clientPara.playerId, gameTypeId, setName);
  }
  async onSavePlayerSetRequest(client, gameTypeId, setName, set) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.setPlayerSet(clientPara.playerId, gameTypeId, setName, set);
  }

  async onGetGameRequest(client, gameId) {
    this.throttle(client.address, 'getGame');

    /*
     * When getting a game, leave out the turn history as an efficiency measure.
     */
    const game = await this.data.getGame(gameId);
    const gameData = game.toJSON();
    gameData.state = gameData.state.getData();

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
    const playerId = this.clientPara.get(client.id).playerId;
    const player = await this._getAuthPlayer(playerId);
    return this.data.searchPlayerGames(player, query);
  }
  async onSearchGameCollectionRequest(client, collection, query) {
    if (!this.config.collections.includes(collection))
      throw new ServerError(400, 'Unrecognized game collection');

    const playerId = this.clientPara.get(client.id).playerId;
    const player = await this._getAuthPlayer(playerId);
    return this.data.searchGameCollection(player, collection, query);
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

  async onJoinGameGroup(client, groupPath, gameId, params) {
    const game = await this.data.openGame(gameId);
    // Abort if the client is no longer connected.
    if (client.closed) {
      this.data.closeGame(game);
      return;
    }

    const firstJoined = !this.gamePara.has(gameId);
    if (firstJoined) {
      const emit = event => {
        // Forward game state and playerRequest events to clients.
        this._emit({
          type: 'event',
          body: {
            group: groupPath,
            type: event.type,
            data: event.data,
          },
        });

        // Only send a notification after the first playable turn
        // This is because notifications are already sent elsewhere on game start.
        if (event.type === 'startTurn' && event.data.startedAt > game.state.startedAt)
          this._notifyYourTurn(game);
      };
      game.state.on('*', emit);
      game.on('playerRequest', emit);

      this.gamePara.set(gameId, {
        playerStatus: new Map(),
        clients: new Set(),
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
    gamePara.clients.add(client.id);

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

    const gameData = game.toJSON();
    const state = gameData.state = game.state.getData();

    const isPlayer = state.teams.findIndex(t => t?.playerId === playerId) > -1;
    if (isPlayer) {
      this._setGamePlayersStatus(gameId);
      this._watchClientIdleForGame(gameId, client);
    } else if (firstJoined)
      this._setGamePlayersStatus(gameId);

    const response = {
      playerStatus: [ ...gamePara.playerStatus ]
        .map(([playerId, playerStatus]) => ({ playerId, ...playerStatus })),
      gameData,
    };

    // Parameters are used to resume a game from a given point.
    // This is done by only sending the data that has changed
    if (params) {
      // These values are set when a game is created and cannot be changed.
      // So, when resuming a game, these values need not be sent.
      delete gameData.type;
      delete gameData.collection;
      delete gameData.createdAt;
      delete gameData.createdBy;
      delete gameData.randomFirstTurn;
      delete gameData.randomHitChance;
      delete gameData.turnTimeLimit;

      if (params.since === 'start') {
        // Nothing has changed if the game hasn't started yet... for now.
        if (!state.startedAt)
          delete gameData.state;
      }
      else if (params.since === 'end')
        // Game data doesn't change after game end
        delete gameData.state;
      else {
        // Once the game starts, the teams do not change... for now.
        delete state.startedAt;
        delete state.teams;

        params.since = new Date(params.since);
        const since = state.actions.length ? state.actions.last.createdAt : state.turnStartedAt;

        if (+params.since === +since)
          // Nothing has changed
          delete gameData.state;
        else if (state.currentTurnId === params.turnId) {
          // Current turn hasn't changed
          delete state.currentTurnId;
          delete state.currentTeamId;

          // Don't need the units at start of turn if they were already seen
          if (params.since >= state.turnStartedAt) {
            delete state.turnStartedAt;
            delete state.units;
          }

          // What actions has the client not seen yet?
          const newActions = state.actions.filter(a => a.createdAt > params.since);

          // Are all client actions still valid?  (not reverted)
          const actionsAreValid = params.nextActionId === state.actions.length - newActions.length;

          if (actionsAreValid) {
            // Existing actions haven't changed
            delete state.actions;

            if (newActions.length) {
              // But there are new actions to append
              response.newActions = newActions;
            }
          }
        }
      }

      if (!state.endedAt) {
        delete state.endedAt;
        delete state.winnerId;
      }

      if (Object.keys(state).length === 0)
        delete gameData.state;
    }
    else {
      const gameData = game.toJSON();
      gameData.state = game.state.getData();

      response.gameData = gameData;
    }

    return response;
  }
  async onJoinMyGamesGroup(client, groupPath, playerId, params) {
    const clientPara = this.clientPara.get(client.id);
    if (playerId !== clientPara.playerId)
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
    if (params.query) {
      const player = await this._getAuthPlayer(playerId);
      response.results = await this.data.searchPlayerGames(player, params.query);
    }

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
    const allCollectionIds = this.config.collections;
    const collectionIds = [];

    if (groupPath === '/collections')
      collectionIds.push(...allCollectionIds);
    else if (allCollectionIds.includes(collectionId))
      collectionIds.push(collectionId);
    else
      collectionIds.push(...allCollectionIds.filter(c => c.startsWith(`${collectionId}/`)));
    if (collectionIds.length === 0)
      throw new ServerError(404, 'No such collection');

    const collections = [];
    for (const cId of collectionIds) {
      collections.push(await this.data.openGameCollection(cId));
    }
    // Abort if the client is no longer connected.
    if (client.closed) {
      for (const cId of collectionIds) {
        this.data.closeGameCollection(cId);
      }
      return;
    }

    const clientPara = this.clientPara.get(client.id);
    const player = await this._getAuthPlayer(clientPara.playerId);

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
      if (allCollectionIds.includes(collectionId))
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
      game.state.off('*', gamePara.emit);
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
    const allCollectionIds = this.config.collections;
    const collectionIds = [];

    if (groupPath === '/collections')
      collectionIds.push(...allCollectionIds);
    else if (allCollectionIds.includes(collectionId))
      collectionIds.push(collectionId);
    else
      collectionIds.push(...allCollectionIds.filter(c => c.startsWith(`${collectionId}/`)));

    const collections = [];
    for (const cId of collectionIds) {
      collections.push(this.data.closeGameCollection(cId));
    }

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
  onPlayerRequestRequest(client, groupPath, requestType) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const clientPara = this.clientPara.get(client.id);
    if (!clientPara.joinedGroups.has(groupPath))
      throw new ServerError(412, 'You must first join the game group');

    const playerId = clientPara.playerId;
    const game = this.data.getOpenGame(gameId);

    game.submitPlayerRequest(playerId, requestType);
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

  async _resolveTeamsSets(game, gameType, teams) {
    /*
     * Resolve default sets before resolving opponent sets
     */
    const opponentSetTeams = [];

    for (const team of teams) {
      if (!team)
        continue;

      if (!gameType.isCustomizable || team.set === null)
        team.set = gameType.getDefaultSet();
      else if (typeof team.set === 'object' && !team.set.units)
        team.set = await this.data.getPlayerSet(team.playerId, gameType, team.set.name);
      else if (team.set === 'same')
        opponentSetTeams.push(team);
      else if (team.set === 'mirror')
        opponentSetTeams.push(team);

      // Avoid saving some fields in the game data
      if (typeof team.set === 'object')
        team.set = { units:team.set.units };
    }

    if (opponentSetTeams.length) {
      const opponentSet = teams.find(t => typeof t?.set !== 'string').set;
      for (const team of opponentSetTeams) {
        if (team.set === 'same')
          team.set = {
            via: 'same',
            ...opponentSet,
          };
        else if (team.set === 'mirror') {
          if (Object.keys(opponentSet).length !== 1)
            throw new ServerError(501, 'Unsupported keys in set');

          team.set = {
            via: 'mirror',
            units: opponentSet.units.map(u => {
              const unit = {...u};
              unit.assignment = [...unit.assignment];
              unit.assignment[0] = 10 - unit.assignment[0];
              if (unit.direction === 'W')
                unit.direction = 'E';
              else if (unit.direction === 'E')
                unit.direction = 'W';
              return unit;
            }),
          };
        }
      }
    }
  }
  async _joinGame(game, gameType, team) {
    const teams = game.state.teams;

    game.state.join(team);

    /*
     * If no open slots remain, start the game.
     */
    if (teams.findIndex(t => !t?.joinedAt) === -1) {
      await this._resolveTeamsSets(game, gameType, teams);

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
