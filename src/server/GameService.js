import uaparser from 'ua-parser-js';

import setsById from '#config/sets.js';
import AccessToken from '#server/AccessToken.js';
import Service from '#server/Service.js';
import ServerError from '#server/Error.js';
import Timeout from '#server/Timeout.js';
import Game from '#models/Game.js';
import GameSummary from '#models/GameSummary.js';
import Team from '#models/Team.js';
import Player from '#models/Player.js';
import PlayerStats from '#models/PlayerStats.js';
import { search, test } from '#utils/jsQuery.js';
import seqAsync from '#utils/seqAsync.js';

import serializer, { unionType } from '#utils/serializer.js';

// When the server is shut down in the middle of an auto surrender game,
// the participants are allowed to safely bail on the game if they do not
// show up.  When their time limit expires, the game ends in truce.
const protectedGameIds = new Set();
const ACTIVE_LIMIT = 120;
const idleWatcher = function (session, oldIdle) {
  const clientPara = this.clientPara.get(session.id);
  const playerPara = this.playerPara.get(clientPara.playerId);
  const newInactive = session.idle > ACTIVE_LIMIT;
  const oldInactive = oldIdle > ACTIVE_LIMIT;

  for (const gameId of clientPara.joinedGameGroups) {
    if (newInactive !== oldInactive)
      this._setGamePlayersStatus(gameId);
    if (session.idle < oldIdle && playerPara.notifyGameIds.has(gameId))
      playerPara.notifyGameIds.delete(gameId);
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
        // Admin actions
        resetRatings: [ 'uuid', 'string | null' ],
        grantAvatar: [ 'uuid', 'string' ],

        createGame: ['string', 'game:options'],
        tagGame: ['uuid', 'game:tags'],
        forkGame: ['uuid', 'game:forkOptions'],
        cancelGame: ['uuid'],
        declineGame: ['uuid'],
        joinGame: [ 'uuid', 'game:joinTeam' ],

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
        searchMyGames: [ 'object | array' ],
        getRatedGames: [ 'string', 'uuid | null' ],

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
            'invite?': 'const(true)',
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
          'collection?': 'string | null',
          'randomFirstTurn?': 'boolean',
          'randomHitChance?': 'boolean',
          'undoMode?': `enum([ 'strict', 'normal', 'loose' ])`,
          'strictFork?': 'boolean',
          'autoSurrender?': 'boolean',
          'rated?': 'boolean | null',
          'timeLimitName?': `enum([ null, 'blitz', 'standard', 'pro', 'day', 'week' ])`,
          'tags?': 'game:tags',
        },
        forkOptions: unionType(
          {
            'turnId?': 'integer(0)',
            'vs?': `const('yourself')`,
          },
          {
            'turnId?': 'integer(0)',
            vs: `enum([ 'same', 'invite' ]) | uuid`,
            as: `integer(0,4)`,
            'timeLimitName?': `enum([ 'day', 'week' ])`,
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
      for (const game of await this._getGames(items.keys()))
        game.state.sync({ type:'willSync' });
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
        } else if (game.state.actions.length) {
          if (game.state.actions.last.type === 'endTurn') {
            this.debug(`autoSurrender: ${game.id}: error: Need sync!`);
            game.state.sync({ type:'willSync' });
          } else
            game.state.submitAction({
              type: 'endTurn',
              forced: true,
            });
        } else if (this._getPlayerGameIdle(game.state.currentTeam.playerId, game) > 30)
          game.state.submitAction({
            type: 'surrender',
            declaredBy: 'system',
          });
        else
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
          game.expire();
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

        if (!game.state.startedAt || game.state.endedAt)
          state.autoSurrender.delete(gameId);
        else if (game.state.getTurnTimeRemaining() < 300000) {
          protectedGameIds.add(game.id);
          game.state.currentTurn.resetTimeLimit(300);
          state.autoSurrender.add(game.id, true, game.state.getTurnTimeRemaining());
          this._notifyYourTurn(game);
        }
      }

      state.autoSurrender.resume();
    }

    this.auth.syncRankings(this.data.getGameTypesById());

    return super.initialize();
  }

  async cleanup() {
    const state = this.data.state;
    state.autoSurrender.pause();
    state.willSync.pause();
    state.shutdownAt = new Date();

    const games = await this._getGames(state.autoCancel.keys());
    await Promise.all(games.filter(g => !g.state.startedAt).map(g => g.expire()));

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

    const player = clientPara.player;
    this.auth.closePlayer(player.id);
    this.data.closePlayer(player);

    const playerPara = this.playerPara.get(player.id);
    if (playerPara.clients.size > 1)
      playerPara.clients.delete(client.id);
    else {
      this.playerPara.delete(player.id);
      this.push.hasAnyPushSubscription(player.id).then(extended => {
        // Make sure the player is still logged out
        if (!this.playerPara.has(player.id))
          this._closeAutoCancel(player.id, extended);
      });
    }

    this.clientPara.delete(client.id);

    // Let people who needs to know about a potential status change.
    this._setPlayerGamesStatus(player.id);
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
        numActiveGamesPerPlayer: item.numActiveGamesPerPlayer,
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
        joinedGameGroups: new Set(),
        playerId,
        player: await this.auth.openPlayer(playerId),
        deviceType: uaparser(client.agent).device.type,
      };
      await this.data.openPlayer(clientPara.player);

      // Did the connection close while fetching data?
      if (client.closed) {
        this.auth.closePlayer(playerId);
        this.data.closePlayer(clientPara.player);
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
        notifyGameIds: new Set(),
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

  async onResetRatingsRequest(client, targetPlayerId, rankingId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    if (process.env.NODE_ENV !== 'development') {
      const clientPara = this.clientPara.get(client.id);
      if (!clientPara.player.identity.admin)
        throw new ServerError(403, 'You must be an admin to use this feature.');
    }

    const target = await this._getAuthPlayer(targetPlayerId);
    if (!target.verified)
      throw new ServerError(400, 'Player must be verified to reset ratings');

    const stats = await this.data.getPlayerStats(target);
    if (stats.ratings.size === 0)
      throw new ServerError(400, 'Player has no ratings to reset');

    stats.clearRatings(rankingId);
    target.identity.setRanks(targetPlayerId, stats.ratings);
  }
  async onGrantAvatarRequest(client, targetPlayerId, unitType) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    if (process.env.NODE_ENV !== 'development') {
      const clientPara = this.clientPara.get(client.id);
      if (!clientPara.player.identity.admin)
        throw new ServerError(403, 'You must be an admin to use this feature.');
    }

    const target = await this._getAuthPlayer(targetPlayerId);
    const avatars = await this.data.getPlayerAvatars(target);
    avatars.grant(unitType);
  }

  /*
   * Create a new game and save it to persistent storage.
   */
  async onCreateGameRequest(client, gameTypeId, gameOptions) {
    const clientPara = this.clientPara.get(client.id);
    const creatorId = clientPara.playerId;
    const creator = this.playerPara.get(creatorId).player;

    if (gameOptions.collection) {
      await this._validateCreateGameForCollection(gameTypeId, gameOptions);

      if (gameOptions.rated && !creator.verified)
        throw new ServerError(403, 'Guest accounts cannot create rated games');
    } else if (gameOptions.rated)
      throw new ServerError(403, 'Private games cannot be rated');

    if (gameOptions.teams.findIndex(t => t?.playerId === creatorId && t.set !== undefined) === -1)
      throw new ServerError(400, 'You must join games that you create');

    const isMultiplayer = gameOptions.teams.findIndex(t => t?.playerId !== creatorId) > -1;
    if (!isMultiplayer) {
      if (gameOptions.rated)
        throw new ServerError(400, `Single player games can't be rated`);
      else
        gameOptions.rated = false;

      if (gameOptions.timeLimitName)
        throw new ServerError(400, `Single player games can't have a time limit`);
    } else if (gameOptions.undoMode === 'loose') {
      if (gameOptions.rated)
        throw new ServerError(400, `Practice games can't be rated`);
      else
        gameOptions.rated = false;
    }

    gameOptions.createdBy = creatorId;
    gameOptions.type = gameTypeId;

    const game = Game.create({
      ...gameOptions,
      teams: new Array(gameOptions.teams.length).fill(null),
    });
    const gameType = await this.data.getGameType(gameTypeId);

    for (const [slot, teamData] of gameOptions.teams.entries()) {
      if (!teamData) continue;

      teamData.slot = slot;

      if (teamData.playerId) {
        if (teamData.playerId === creatorId) {
          if (teamData.name !== undefined && teamData.name !== null && teamData.name !== creator.name)
            await Player.validatePlayerName(teamData.name, creator.identity);
        } else {
          const player = await this._getAuthPlayer(teamData.playerId);
          if (!player)
            throw new ServerError(404, `Team ${slot} has an unrecognized playerId`);
          if (teamData.name !== undefined)
            throw new ServerError(403, 'May not assign a name to a reserved team');
          teamData.name = player.name;

          if (player.hasBlocked(creator))
            throw new ServerError(403, 'Sorry!  You are blocked from challenging this player.');

          /*
           * You can't challenge a blocked player.  But you can downgrade them to muted first.
           */
          if (creator.hasBlocked(player, false)) {
            const relationship = creator.getRelationship(player);
            creator.mute(player, relationship.name);
          }
        }
      } else if (teamData.name !== undefined)
        throw new ServerError(400, `Team ${slot} playerId field is required if a name is present`);

      let team;
      if (teamData.playerId && teamData.playerId !== creatorId)
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
      if (game.state.currentTeam.playerId !== creatorId)
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

    if (![ 'yourself', 'same', 'invite' ].includes(options.vs)) {
      const player = await this._getAuthPlayer(options.vs);
      if (!player)
        throw new ServerError(409, `Team ${slot} has an unrecognized playerId`);
      options.vs = { playerId:player.id, name:player.name };
    }

    const clientPara = this.clientPara.get(client.id);
    const game = await this._getGame(gameId);
    const newGame = await this.data.forkGame(game, clientPara, options);

    return newGame.id;
  }

  async onJoinGameRequest(client, gameId, teamData) {
    this.debug(`joinGame: gameId=${gameId}`);

    const clientPara = this.clientPara.get(client.id);
    const playerId = clientPara.playerId;
    const player = this.playerPara.get(playerId).player;
    const game = await this._getGame(gameId);
    const gameType = await this.data.getGameType(game.state.type);
    const creator = await this._getAuthPlayer(game.createdBy);

    if (game.state.startedAt)
      throw new ServerError(409, 'The game has already started.');

    if (creator.hasBlocked(player, !!game.collection))
      throw new ServerError(403, 'You are blocked from joining this game.');

    if (teamData.name !== undefined && teamData.name !== null && teamData.name !== player.name)
      await Player.validatePlayerName(teamData.name, player.identity);

    if (game.collection) {
      const playerIds = new Set(game.state.teams.filter(t => t?.joinedAt).map(t => t.playerId));
      playerIds.add(playerId);

      await Promise.all([ ...playerIds ].map(pId => this._validateJoinGameForCollection(
        pId,
        this.collections.get(game.collection),
        playerIds.size === game.state.teams.length && gameId,
      )));

      if (game.state.rated) {
        const { rated, reason } = this._canPlayRatedGame(game, creator, player);
        if (!rated) {
          if (reason === 'not verified')
            throw new ServerError(403, 'Guests cannot join rated games');
          else if (reason === 'same identity')
            throw new ServerError(403, 'Cannot play yourself in a rated game');
          else if (reason === 'in game')
            throw new ServerError(403, 'You are already playing this person in a rated game in this style');
          else if (reason === 'too many games')
            throw new ServerError(403, 'You have played this person in a rated game twice in this style in the past week');
        }
      }
    }

    /*
     * You can't play a blocked player.  But you can downgrade them to muted first.
     */
    if (player.hasBlocked(creator, false)) {
      const relationship = player.getRelationship(creator);
      player.mute(creator, relationship.name);
    }

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
      throw new ServerError(403, `You cannot cancel other players' games`);

    game.cancel();
  }
  async onDeclineGameRequest(client, gameId) {
    this.debug(`declineGame: gameId=${gameId}`);

    const clientPara = this.clientPara.get(client.id);
    const game = await this._getGame(gameId);
    if (!game.state.getTeamForPlayer(clientPara.playerId))
      throw new ServerError(403, `You cannot decline other players' games`);

    game.decline();
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

    return this.data.getPlayerSets(clientPara.player, gameTypeId);
  }
  async onGetPlayerSetRequest(client, gameTypeId, setId) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.getPlayerSet(clientPara.player, gameTypeId, setId);
  }
  async onSavePlayerSetRequest(client, gameTypeId, set) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.setPlayerSet(clientPara.player, gameTypeId, set);
  }
  async onDeletePlayerSetRequest(client, gameTypeId, setId) {
    const clientPara = this.clientPara.get(client.id);

    return this.data.unsetPlayerSet(clientPara.player, gameTypeId, setId);
  }

  async onGetMyAvatarRequest(client) {
    const clientPara = this.clientPara.get(client.id);
    const playerAvatars = await this.data.getPlayerAvatars(clientPara.player);

    return playerAvatars.avatar;
  }
  async onSaveMyAvatarRequest(client, avatar) {
    const clientPara = this.clientPara.get(client.id);
    const playerAvatars = await this.data.getPlayerAvatars(clientPara.player);

    playerAvatars.avatar = avatar;
  }
  async onGetMyAvatarListRequest(client) {
    const clientPara = this.clientPara.get(client.id);
    const playerAvatars = await this.data.getPlayerAvatars(clientPara.player);

    return playerAvatars.list;
  }
  async onGetPlayersAvatarRequest(client, playerIds) {
    const playersAvatar = await this.data.listPlayersAvatar(playerIds);

    return playersAvatar;
  }

  async onGetGameRequest(client, gameId) {
    this.throttle(client.address, 'getGame');

    /*
     * When getting a game, leave out the turn history as an efficiency measure.
     */
    const clientPara = this.clientPara.get(client.id);
    const game = await this._getGame(gameId);

    const gameData = await game.getSyncForPlayer(clientPara?.playerId);
    gameData.meta = await this._getGameMeta(game, clientPara?.player);

    return gameData;
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
  async onGetPlayerInfoRequest(client, groupPath, vsPlayerId) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const clientPara = this.clientPara.get(client.id);
    if (!clientPara.joinedGroups.has(groupPath))
      throw new ServerError(412, 'To get player activity for this game, you must first join it');

    const game = this.data.getOpenGame(gameId);
    if (!game.state.startedAt)
      throw new ServerError(403, 'To get player info for this game, the game must first start.');

    const myPlayerId = this.clientPara.get(client.id).playerId;
    if (myPlayerId === vsPlayerId)
      throw new ServerError(403, 'May not get player info for yourself.');
    if (!game.state.teams.find(t => t.playerId === myPlayerId))
      throw new ServerError(403, 'To get player info for this game, you must be a participant.');

    const team = game.state.teams.find(t => t.playerId === vsPlayerId);
    if (!team)
      throw new ServerError(403, 'To get player info for this game, they must be a participant.');

    const me = clientPara.player;
    const vsStats = (await this.data.getPlayerStats(me, [ vsPlayerId ])).vs.get(vsPlayerId);
    if (!vsStats)
      throw new ServerError(404, 'Player stats are unavailable.');

    const gameTypesById = await this.data.getGameTypesById();
    const them = await this._getAuthPlayer(vsPlayerId);
    const ranks = them.identity.getRanks();
    const themStats = await this.data.getPlayerStats(them);

    return {
      createdAt: them.createdAt,
      completed: [ themStats.numCompleted, themStats.numAbandoned ],
      canNotify: await this.push.hasAnyPushSubscription(vsPlayerId),
      acl: new Map([
        ['me', me.acl],
        ['them', them.acl],
      ]),
      isNew: new Map([
        ['me', me.isNew],
        ['them', them.isNew],
      ]),
      isVerified: new Map([
        ['me', me.verified],
        ['them', them.verified],
      ]),
      relationship: me.getRelationship(them),
      stats: {
        ratings: ranks.map(rank => ({
          gameTypeId: rank.rankingId,
          gameTypeName: rank.rankingId === 'FORTE' ? 'Forte' : gameTypesById.get(rank.rankingId).name,
          rating: rank.rating,
          gameCount: rank.gameCount,
        })),
        aliases: [...vsStats.aliases.values()]
          .filter(a => a.name.toLowerCase() !== team.name.toLowerCase())
          .sort((a, b) =>
            b.count - a.count || b.lastSeenAt - a.lastSeenAt
          )
          .slice(0, 10),
        all: vsStats.all,
        style: vsStats.style.get(game.state.type) ?? {
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
    const ranks = player.identity.getRanks();
    const gameTypesById = await this.data.getGameTypesById();
    const myStats = await this.data.getPlayerStats(player);

    return {
      createdAt: player.createdAt,
      completed: [ myStats.numCompleted, myStats.numAbandoned ],
      isVerified: player.verified,
      stats: {
        ratings: ranks.map(rank => ({
          gameTypeId: rank.rankingId,
          gameTypeName: rank.rankingId === 'FORTE' ? 'Forte' : gameTypesById.get(rank.rankingId).name,
          rating: rank.rating,
          gameCount: rank.gameCount,
        })),
      },
    };
  }
  async onClearWLDStatsRequest(client, vsPlayerId, gameTypeId) {
    const player = this.clientPara.get(client.id).player;
    await this.data.clearPlayerWLDStats(player, vsPlayerId, gameTypeId);
  }

  async onSearchMyGamesRequest(client, query) {
    const player = this.clientPara.get(client.id).player;
    return this._searchPlayerGames(player, query);
  }
  async onSearchGameCollectionRequest(client, collectionId, query) {
    if (!this.collections.has(collectionId))
      throw new ServerError(400, 'Unrecognized game collection');

    const player = this.clientPara.get(client.id).player;

    return this._searchGameCollection(player, collectionId, query);
  }
  async onGetRatedGamesRequest(client, rankingId, playerId) {
    const gamesSummary = playerId
      ? await this.data.getPlayerRatedGames(playerId, rankingId)
      : await this.data.getRatedGames(rankingId);

    return Promise.all(Array.from(gamesSummary.entries()).map(([ i, gs ]) => this._cloneGameSummaryWithMeta(gs)))
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
      return this.onLeaveGameGroup(client, groupPath, groupPath.slice(7), 'request');
    else if (groupPath.startsWith('/myGames/'))
      return this.onLeaveMyGamesGroup(client, groupPath, groupPath.slice(9));
    else if (groupPath === '/collections' || groupPath.startsWith('/collections/'))
      return this.onLeaveCollectionGroup(client, groupPath, groupPath.slice(13));
    else
      throw new ServerError(404, 'No such group');
  }

  async onJoinGameGroup(client, groupPath, gameId, reference) {
    const game = await this._openGame(gameId);
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
    clientPara.joinedGameGroups.add(gameId);

    const playerId = clientPara.playerId;
    const playerPara = this.playerPara.get(playerId);
    if (playerPara.joinedGameGroups.has(gameId))
      playerPara.joinedGameGroups.get(gameId).add(client.id);
    else
      playerPara.joinedGameGroups.set(gameId, new Set([client.id]));

    const gamePara = this.gamePara.get(gameId);
    const sync = await game.getSyncForPlayer(playerId, reference);
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
      if (!game.state.isSinglePlayer)
        game.checkin(team);
      this._setGamePlayersStatus(gameId);
      if (clientPara.joinedGameGroups.size === 1)
        client.session.onIdleChange = this.idleWatcher;
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
        clientsInfo: new Set(),
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

      playerGames.on('change', myGames.changeListener = seqAsync(async event => {
        const gameSummary = await this._cloneGameSummaryWithMeta(event.data.gameSummary ?? event.data.oldSummary, player);

        if (event.type === 'change:set') {
          if (event.data.oldSummary)
            emit({ type:'change', data:gameSummary });
          else
            emit({ type:'add', data:gameSummary });
        } else if (event.type === 'change:delete')
          emit({ type:'remove', data:gameSummary});

        const newStats = await this._getGameSummaryListStats(playerGames);
        if (newStats.waiting !== stats.waiting || newStats.active !== stats.active)
          emit({ type: 'stats', data: Object.assign(stats, newStats) });
      }));
    }

    const myGames = playerPara.myGames;
    myGames.clientsInfo.add(client.id);

    const response = {
      stats: myGames.stats,
    };
    if (params.query)
      response.results = await this._searchPlayerGames(player, params.query);

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
  /*
   * TODO: This method is sensitive to a client disconnecting before asynchronous tasks are done.
   * This means an attempt is made to join a group for a client with no session.
   * This means crashing the application.
   * Try to isolate all side effects after asynchronous activity is complete.
   * That way, we can check connection status after asynchronous activity is done and before side effects.
   */
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
      for (const cId of collectionIds)
        this.data.closeGameCollection(cId);
      return;
    }

    const clientPara = this.clientPara.get(client.id);
    const player = clientPara.player;

    for (const collection of collections) {
      if (!this.collectionPara.has(collection.id)) {
        const collectionGroup = `/collections/${collection.id}`;
        const changeListener = seqAsync(event => {
          const collectionPara = this.collectionPara.get(collection.id);
          const gameSummary = event.data.gameSummary ?? event.data.oldSummary;
          const gameSummaryByPlayer = new Map();

          return Promise.all(Array.from(collectionPara.clientsInfo).map(async ([ clientId, clientInfo ]) => {
            const player = this.clientPara.get(clientId).player;

            // A game can move from not visible to visible if a blocked game moved from waiting to active.
            const wasVisible = await this._isGameVisible(event.data.oldSummary, player, clientInfo.filters);
            const isVisible = await this._isGameVisible(event.data.gameSummary, player, clientInfo.filters);
            const eventType = (
              !wasVisible && !isVisible ? 'none' :
              !wasVisible && isVisible ? 'add' :
              wasVisible && !isVisible ? 'remove' :
              'change'
            );
            if (eventType === 'none')
              return;

            if (!gameSummaryByPlayer.has(player))
              gameSummaryByPlayer.set(player, await this._cloneGameSummaryWithMeta(gameSummary, player));

            this._emit({
              type: 'event',
              clientId,
              body: {
                group: collectionGroup,
                type: eventType,
                data: gameSummaryByPlayer.get(player),
              },
            });

            const stats = collectionPara.stats.get(player);

            if (!this._adjustGameSummaryListStats(stats, eventType, event.data.gameSummary, event.data.oldSummary))
              return;

            const parts = collectionGroup.split('/');
            for (let i = 1; i < parts.length; i++) {
              const group = parts.slice(0, i + 1).join('/');

              this._emit({
                type: 'event',
                clientId,
                body: {
                  group,
                  type: 'stats',
                  data: { collectionId:collection.id, stats },
                },
              });
            }
          }));
        });

        collection.on('change', changeListener);

        this.collectionPara.set(collection.id, {
          clientsInfo: new Map(),
          stats: new Map(),
          changeListener,
        });
      }

      const collectionPara = this.collectionPara.get(collection.id);

      const clientsInfo = collectionPara.clientsInfo;
      if (!clientsInfo.has(client.id))
        clientsInfo.set(client.id, { joinCount:0, filters:[] });
      const clientInfo = clientsInfo.get(client.id);
      clientInfo.joinCount++;

      if (params.query)
        if (Array.isArray(params.query))
          clientInfo.filters.push(params.query.map(q => q.filter));
        else
          clientInfo.filters.push(params.query.filter);
      else if (params.filter)
        clientInfo.filters.push(params.filter);

      const stats = collectionPara.stats;
      if (!stats.has(player))
        stats.set(player, await this._getGameSummaryListStats(collection, player, clientInfo.filters));
    }

    clientPara.joinedGroups.add(groupPath);

    const response = {};
    if (params.query)
      if (this.collections.has(collectionId))
        response.results = await this._searchGameCollection(player, collectionId, params.query);
      else
        throw new ServerError(400, 'Can not query collection stats');

    response.stats = new Map();
    for (const cId of collectionIds)
      response.stats.set(cId, this.collectionPara.get(cId).stats.get(player));

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
  async _getGames(gameIds) {
    const games = await this.data.getGames(gameIds);
    games.forEach(g => this._attachGame(g));
    return games;
  }
  async _openGame(gameId) {
    const game = await this.data.openGame(gameId);
    this._attachGame(game);
    return game;
  }
  async _getGame(gameId) {
    const game = await this.data.getGame(gameId);
    this._attachGame(game);
    return game;
  }
  /*
   * game can be either a Game or GameSummary object.
   */
  _canPlayRatedGame(game, player, opponent) {
    if (!game.collection)
      return { rated:false, reason:'private' };

    // Both players must be verified
    if (!player.verified || !opponent.verified)
      return { rated:false, reason:'not verified' };

    // Can't play a rated game against yourself
    if (player.identityId === opponent.identityId)
      return { rated:false, reason:'same identity' };

    return { rated:true };
  }
  /*
   * The game argument can be either a Game or GameSummary object.
   */
  async _getGameMeta(game, player = null) {
    const meta = {};
    const data = {};
    const promises = [];

    if (game instanceof Game)
      Object.assign(data, {
        collection: game.collection,
        createdBy: game.createdBy,
        rated: game.state.rated,
        startedAt: game.state.startedAt,
        teams: game.state.teams,
        type: game.state.type,
      });
    else if (game instanceof GameSummary)
      Object.assign(data, {
        collection: game.collection,
        createdBy: game.createdBy,
        rated: game.rated,
        startedAt: game.startedAt,
        teams: game.teams,
        type: game.type,
      });

    if (player && !data.startedAt && data.createdBy !== player.id) {
      const creator = await this._getAuthPlayer(data.createdBy);
      meta.creator = {
        relationship: player.getRelationship(creator),
        createdAt: creator.createdAt,
      };

      if (data.rated !== false) {
        const { rated, reason } = this._canPlayRatedGame(game, creator, player);
        meta.rated = rated;
        meta.unratedReason = reason;
      } else {
        meta.rated = false;
        meta.unratedReason = 'not rated';
      }
    }

    const playerIds = Array.from(new Set(data.teams.filter(t => !!t).map(t => t.playerId)));
    const rankingIds = [ 'FORTE', game.type ];

    promises.push(this.auth.getPlayerRanks(playerIds, rankingIds).then(ranksByPlayerId => {
      meta.ranks = data.teams.map((t,i) => {
        if (!t) return null;

        return ranksByPlayerId.get(t.playerId);
      });
    }));

    await Promise.all(promises);

    return meta;
  }
  async _cloneGameSummaryWithMeta(gameSummary, player) {
    return gameSummary.cloneWithMeta(await this._getGameMeta(gameSummary, player));
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
      const reason = event.type.slice(7);
      const gamePara = this.gamePara.get(game.id);
      if (gamePara)
        for (const clientId of gamePara.clients.keys())
          this.onLeaveGameGroup(this.clientPara.get(clientId).client, `/games/${game.id}`, game.id, reason);

      this.data.deleteGame(game).then(event.whenDeleted.resolve, event.whenDeleted.reject);
    });
  }
  async _recordGameStats(game) {
    const playerIds = Array.from(new Set([ ...game.state.teams.map(t => t.playerId) ]));
    const players = await Promise.all(playerIds.map(pId => this._getAuthPlayer(pId)));
    const playersStats = await Promise.all(players.map(p => this.data.getPlayerStats(p, playerIds)));
    const playersMap = new Map(players.map(p => [ p.id, p ]));
    const playersStatsMap = new Map(playersStats.map(ps => [ ps.playerId, ps ]));

    if (game.state.endedAt) {
      if (game.state.rated) {
        const slowMode = await this.data.getGameSlowMode(game, ...players);
        if (PlayerStats.updateRatings(game, playersStatsMap, slowMode))
          for (const playerStats of playersStats)
            playersMap.get(playerStats.playerId).identity.setRanks(playerStats.playerId, playerStats.ratings);
      }

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
        for (const key of Object.keys(collection.gameOptions.defaults))
          if (gameOptions[key] === undefined || gameOptions[key] === null)
            gameOptions[key] = collection.gameOptions.defaults[key];

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

    // For now, the presence of a set in a team indicates that the team has been "joined".
    // But when rematch games are supported, we might want to explicitly indicate a team
    // is simply "reserved" for a given playerId or otherwise indicate that the player for
    // a team is "ready".
    const playerIds = new Set(gameOptions.teams.filter(t => t?.set).map(t => t.playerId));
    await Promise.all([...playerIds].map(pId => this._validateJoinGameForCollection(pId, collection)));
  }
  /*
   * Enforce collection limits
   */
  async _validateJoinGameForCollection(playerId, collection, startGameId = false) {
    let node = collection;
    while (node) {
      if (node.numActiveGamesPerPlayer) {
        const gamesSummary = await this.data.getPlayerPendingGamesInCollection(playerId, node.name);

        const waitingGameIds = [];
        let count = 0;
        for (const gameSummary of gamesSummary) {
          // Waiting games do not count against the limit
          // ... but we'll collect them just in case they need to be cancelled.
          if (!gameSummary.startedAt) {
            if (gameSummary.id !== startGameId)
              waitingGameIds.push(gameSummary.id);
            continue;
          }

          if (++count === node.numActiveGamesPerPlayer)
            throw new ServerError(409, `Too many active ${node.name} games.`);
        }

        if ((count + 1) === node.numActiveGamesPerPlayer && waitingGameIds.length && startGameId) {
          const games = await this._getGames(waitingGameIds);
          games.forEach(g => g.cancel());
        }
      }

      if (node.numPendingGamesPerPlayer) {
        const gamesSummary = await this.data.getPlayerPendingGamesInCollection(playerId, node.name);

        const waitingGameIds = [];
        let count = 0;
        for (const gameSummary of gamesSummary) {
          // Waiting games will not count against the limit because they will be cancelled.
          if (!gameSummary.startedAt) {
            if (gameSummary.id !== startGameId)
              waitingGameIds.push(gameSummary.id);
            continue;
          }

          if (++count === node.numPendingGamesPerPlayer)
            throw new ServerError(409, `Too many open or active ${node.name} games.`);
        }

        if ((count + 1) === node.numPendingGamesPerPlayer && waitingGameIds.length) {
          const games = await this._getGames(waitingGameIds);
          games.forEach(g => g.cancel());
        }
      }

      node = node.parent;
    }
  }
  async _isGameVisible(gameSummary, player = null, filters = null) {
    if (!gameSummary)
      return false;

    /*
     * Determine visibility of the game.
     * Assuming that a game CAN'T change in a way that changes its visibility.
     */
    if (!gameSummary.startedAt && player && gameSummary.createdBy !== player.id) {
      const creator = await this._getAuthPlayer(gameSummary.createdBy);
      if (creator.hasBlocked(player, false))
        return false;
    }
    if (filters && filters.length && !filters.some(f => test(gameSummary, f)))
      return false;

    return true;
  }
  async _getGameSummaryListStats(collection, player = null, filters = null) {
    const stats = { waiting:0, active:0 };

    for (const gameSummary of collection.values()) {
      if (gameSummary.endedAt)
        continue;

      if (!await this._isGameVisible(gameSummary, player, filters))
        continue;

      if (!gameSummary.startedAt)
        stats.waiting++;
      else if (!gameSummary.endedAt)
        stats.active++;
    }

    return stats;
  }
  _adjustGameSummaryListStats(stats, eventType, gameSummary, oldSummary = null) {
    if (eventType === 'add') {
      if (!gameSummary.startedAt)
        stats.waiting++;
      else if (!gameSummary.endedAt)
        stats.active++;
      else
        return false;
    } else if (eventType === 'change') {
      // If not currently started and not previously started, 1 - 1 = 0 (no change)
      // If not currently started and was previuusly started, 1 - 0 = 1 (add, never happens)
      // If currently started and not previously started, 0 - 1 = -1 (sub, game started)
      // If currently started and previously started, 0 + 0 = 0 (no change)
      const waitingChange = (!gameSummary.startedAt ? 1 : 0) + (!oldSummary.startedAt ? -1 : 0);
      const activeChange = (
        (gameSummary.startedAt && !gameSummary.endedAt ? 1 : 0) +
        (oldSummary.startedAt && !oldSummary.endedAt ? -1 : 0)
      );
      if (waitingChange === 0 && activeChange === 0)
        return false;
      stats.waiting += waitingChange;
      stats.active += activeChange;
    } else {
      if (!oldSummary.startedAt)
        stats.waiting--;
      else if (!oldSummary.endedAt)
        stats.active--;
      else
        return false;
    }

    return true;
  }
  async _emitGameSync(game) {
    const gamePara = this.gamePara.get(game.id);

    for (const [clientId, reference] of gamePara.clients.entries()) {
      const clientPara = this.clientPara.get(clientId);
      const sync = await game.getSyncForPlayer(clientPara.playerId, reference);
      if (!sync.reference)
        continue;

      // playerRequest is synced elsewhere
      delete sync.playerRequest;

      gamePara.clients.set(clientId, sync.reference);
      gamePara.emit({ clientId, type: 'sync', data: sync });
    }
  }

  /*
   * No longer send change events to the client about this game.
   * Only called internally since the client does not yet leave intentionally.
   */
  onLeaveGameGroup(client, groupPath, gameId, reason) {
    const game = this.data.closeGame(gameId);

    const clientPara = this.clientPara.get(client.id);
    clientPara.joinedGroups.delete(groupPath);
    clientPara.joinedGameGroups.delete(gameId);

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

    const team = game.getTeamForPlayer(playerId);
    if (team) {
      // If the client is closed, hold off on updating status.
      if (!client.closed && gamePara.clients.size > 0)
        this._setGamePlayersStatus(gameId);

      const checkoutAt = new Date();
      const lastActiveAt = new Date(checkoutAt - client.session.idle * 1000);
      if (!game.state.isSinglePlayer)
        game.checkout(team, checkoutAt, lastActiveAt);

      if (clientPara.joinedGameGroups.size === 0)
        delete client.session.onIdleChange;
    }

    if (playerPara.notifyGameIds.has(gameId)) {
      playerPara.notifyGameIds.delete(gameId);
      if (this._notifyYourTurn(game))
        playerPara.notifyGameIds.clear();
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
        reason,
      },
    });
  }
  onLeaveMyGamesGroup(client, groupPath, playerId) {
    const clientPara = this.clientPara.get(client.id);
    const playerPara = this.playerPara.get(playerId);
    const myGames = playerPara.myGames;

    myGames.clientsInfo.delete(client.id);

    if (myGames.clientsInfo.size === 0) {
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
      const clientsInfo = collectionPara.clientsInfo;
      const clientInfo = clientsInfo.get(client.id);
      if (clientInfo.joinCount > 1)
        clientInfo.joinCount--;
      else {
        clientsInfo.delete(client.id);

        if (clientsInfo.size === 0) {
          collection.off('change', collectionPara.changeListener);

          this.collectionPara.delete(collection.id);
        } else {
          const playerExists = Array.from(clientsInfo.keys()).some(cId => this.clientPara.get(cId).player === clientPara.player);
          if (!playerExists)
            collectionPara.stats.delete(clientPara.player);
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
  async _searchPlayerGames(player, query) {
    const result = await this.data.searchPlayerGames(player, query);
    return this._applyMetaToSearchResult(player, query, result);
  }
  async _searchGameCollection(player, collectionId, query) {
    const result = await this.data.searchGameCollection(player, collectionId, query, this._getAuthPlayer.bind(this));
    return this._applyMetaToSearchResult(player, query, result);
  }
  async _applyMetaToSearchResult(player, query, result) {
    const results = Array.isArray(result) ? result : [ result ];

    await Promise.all(results.map(async result => {
      result.hits = await Promise.all(result.hits.map(gs => this._cloneGameSummaryWithMeta(gs, player)));

      if (result.hits.length && query.metaFilter) {
        const metaResult = search(result.hits, Object.assign({}, query, {
          filter: query.metaFilter,
        }));
        result.count = metaResult.count;
        result.hits = metaResult.hits;
      } 
    }));

    return result;
  }

  _resolveTeamSet(gameType, game, team) {
    const firstTeam = game.state.teams.filter(t => t?.joinedAt).sort((a, b) => a.joinedAt - b.joinedAt)[0];

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
        throw new ServerError(412, 'Sorry!  Looks like the set no longer exists.');
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
        if (game.rated === null) {
          const players = await Promise.all([ ...playerIds ].map(pId => this._getAuthPlayer(pId)));
          const { rated, reason } = this._canPlayRatedGame(game, ...players);
          game.setRated(rated, reason);
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
    for (const playerId of playerStatus.keys())
      if (!teamPlayerIds.has(playerId))
        playerStatus.delete(playerId);

    for (const playerId of teamPlayerIds) {
      const oldPlayerStatus = playerStatus.get(playerId);
      const newPlayerStatus = this._getPlayerGameStatus(playerId, game);
      if (
        newPlayerStatus.status !== oldPlayerStatus?.status ||
        newPlayerStatus.deviceType !== oldPlayerStatus?.deviceType
      ) {
        playerStatus.set(playerId, newPlayerStatus);
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

    // If the player forked a simulation game, provide a link!
    for (const { game } of openGamesInfo) {
      if (game.forkOf?.gameId !== fromGameId) continue;

      activity.forkGameId = game.id;
      break;
    }

    // If the player isn't in game, provide a watch game link if conditions are met.
    // Conditions:
    //   All players must be actively playing.
    //   Must be a public or lobby game.
    //   Must only be one game.
    //   Must not have a simulation game open.
    //
    const activeGamesOfInterest = [];
    for (const { game } of activeGamesInfo) {
      if (game.id === fromGameId) continue;

      if (!game.collection)
        continue;

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

    if (activeGamesOfInterest.length === 1 && !activity.forkGameId)
      activity.activeGameId = activeGamesOfInterest[0].id;

    return activity;
  }

  async _notifyYourTurn(game) {
    const teams = game.state.teams;
    const playerId = game.state.currentTeam.playerId;

    // Only notify if the current player is not already in-game.
    // Still notify if the current player is in-game, but inactive?
    const playerPara = this.playerPara.get(playerId);
    if (playerPara && playerPara.joinedGameGroups.has(game.id)) {
      playerPara.notifyGameIds.add(game.id);
      return false;
    }

    const notification = await this.getYourTurnNotification(playerId);
    // Game count should always be >= 1, but just in case...
    if (notification.gameCount === 0)
      return true;

    const urgency = game.state.rated === true && game.state.timeLimit.base < 86400 ? 'high' : 'normal';

    this.push.pushNotification(playerId, notification, urgency);

    return true;
  }
}
