import setsBySlot from '#config/sets.js';
import AccessToken from '#server/AccessToken.js';
import Service from '#server/Service.js';
import ServerError from '#server/Error.js';
import Timeout from '#server/Timeout.js';
import Game from '#models/Game.js';
import GameSession, { ACTIVE_LIMIT, GameSessionGame, GameSessionPlayer, GameSessionGameSummaryListGroup } from '#models/GameSession.js';
import GameSummary from '#models/GameSummary.js';
import Team from '#models/Team.js';
import TeamSet from '#models/TeamSet.js';
import Player from '#models/Player.js';
import PlayerStats from '#models/PlayerStats.js';
import { search } from '#utils/jsQuery.js';
import seqAsync from '#utils/seqAsync.js';

import serializer, { unionType } from '#utils/serializer.js';

const gameSummaryWithMetaCacheByPlayer = new WeakMap();

// When the server is shut down in the middle of an auto surrender game,
// the participants are allowed to safely bail on the game if they do not
// show up.  When their time limit expires, the game ends in truce.

export default class GameService extends Service {
  constructor(props) {
    super({
      ...props,

      startupAt: null,
      attachedGames: new WeakSet(),
    });

    this.setValidation({
      authorize: { token:AccessToken },
      requests: {
        // Admin actions
        resetRatings: [ 'uuid', 'string | null' ],
        grantAvatar: [ 'uuid', 'string' ],
        grantUnit: [ 'uuid', 'string' ],

        createGame: ['string', 'game:options'],
        tagGame: ['uuid', 'game:tags'],
        forkGame: ['uuid', 'game:forkOptions'],
        cancelGame: ['uuid'],
        declineGame: ['uuid'],
        joinGame: [ 'uuid', 'game:joinTeam' ],

        getGameTypes: [],
        getGameTypeConfig: ['string'],
        getGame: ['uuid'],
        getGameTeamSet: [ 'string', 'uuid', 'integer(0,3)' ],
        getTurnData: ['uuid', 'integer(0)'],
        getTurnActions: ['uuid', 'integer(0)'],

        action: ['game:group', 'game:newAction | game:newAction[]'],
        playerRequest: ['game:group', `enum(['undo','truce'])`],
        getPlayerStatus: ['game:group'],
        getPlayerActivity: ['game:group', 'uuid'],
        getPlayerInfo: ['game:group', 'uuid'],
        getMyInfo: [ 'uuid', 'integer(0,3)' ],
        clearWLDStats: `tuple([ 'uuid', 'string | null' ], 1)`,

        searchGameCollection: ['string', 'any'],
        searchMyGames: [ 'object | array' ],
        getRatedGames: [ 'string', 'uuid | null' ],
        searchTeamSets: "tuple([ 'string', 'game:searchTeamSetsOptions' ], 1)",
        searchTeamSetGames: [ 'string', 'game:searchTeamSetGamesOptions' ],

        getDefaultSet: ['string'],
        getPlayerSets: ['string'],
        getPlayerSet: ['string', 'string'],
        savePlayerSet: ['string', 'game:playerSet'],
        deletePlayerSet: ['string', 'string'],

        getMyAvatar: [],
        saveMyAvatar: ['game:avatar'],
        getMyAvatarList: [],
        getMyUnitList: [],
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
        playerSet: {
          slot: `enum([ '${Array.from(setsBySlot.keys()).join("', '")}' ])`,
          name: 'string',
          units: 'game:newUnit[]',
        },
        tempSet: {
          units: 'game:newUnit[]',
        },
        setOption: unionType(
          'game:tempSet',
          `enum([ 'same', 'mirror', 'random', 'top', '${Array.from(setsBySlot.keys()).join("', '")}' ])`,
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
        searchTeamSetsOptions: {
          'text?': 'string',
          'metricName?': `enum(['rating','gameCount','playerCount'])`,
          'offset?': 'integer',
          'limit?': 'integer',
        },
        searchTeamSetGamesOptions: {
          'setId': 'string',
          'vsSetId': 'string | null',
          'result': `enum(['W','L']) | null`,
          'offset?': 'integer',
          'limit?': 'integer',
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

    GameSessionGame.on('playerStatus', event => {
      const game = event.target.game;
      const playerId = event.data.oldValue.playerId;

      // If the current player leaves active status in a game, we may need to notify them that their turn started.
      if (game.currentTeam?.playerId === playerId && event.data.oldValue.status === 'active')
        this._notifyYourTurn(game);

      this._emit({
        type: 'event',
        body: {
          group: `/games/${game.id}`,
          type: event.type,
          data: event.data.newValue,
        },
      });
    });
    GameSessionGame.on('playerRequest', event => this._emit({
      type: 'event',
      body: {
        group: `/games/${event.target.game.id}`,
        type: event.type,
        data: event.data,
      },
    }));
    GameSessionGame.on('sync', event => this._emit({
      type: 'event',
      clientId: event.clientId,
      body: {
        group: `/games/${event.target.game.id}`,
        type: event.type,
        data: event.data,
      },
    }));
    GameSessionGameSummaryListGroup.on('game', seqAsync(async event => {
      // Abort if a group is closed before we could deliver the event.
      if (!event.target.isRegistered)
        return;

      const player = event.target.gameSession.player;
      const data = await this._cloneGameSummaryWithMeta(event.gameSummary, player);
      if (!event.target.isRegistered)
        return;

      this._emit({
        type: 'event',
        clientId: event.target.gameSession.session.id,
        body: {
          group: event.target.groupPath,
          type: event.type,
          data,
        },
      });
    }));
    GameSessionGameSummaryListGroup.on('stats', event => {
      const collectionId = event.gameSummaryList.id;

      this._emit({
        type: 'event',
        clientId: event.target.gameSession.session.id,
        body: {
          group: event.target.groupPath,
          type: event.type,
          data: event.target.groupPath === '/collections' ? { collectionId, stats:event.stats } : event.stats,
        },
      });
    });

    this.setCollections();
  }

  initialize() {
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

        // If the current player hasn't opened the game since the server started up, end the game in a truce.
        if (
          game.state.currentTurn.startedAt < this.startupAt &&
          game.state.timeLimit.base < 300 &&
          !game.state.currentTeam.seen(this.startupAt)
        )
          game.state.end('truce');
        else if (game.state.actions.some(a => !a.forced)) {
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

    this.auth.syncRankings(this.data.getGameTypesById());

    this.startupAt = new Date();
    return super.initialize();
  }

  async cleanup() {
    const state = this.data.state;
    state.autoSurrender.pause();
    state.willSync.pause();

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
    const session = GameSession.cache.get(client.id);
    if (!session)
      throw new ServerError(401, 'Authorization is required');
    if (session.token.isExpired)
      throw new ServerError(401, 'Token is expired');
  }

  /*
   * Generate a 'yourTurn' notification to indicate that it is currently the
   * player's turn for X number of games.  If only one game, then it provides
   * details for the game and may link to that game.  Otherwise, it indicates
   * the number of games and may link to the active games page.
   */
  async getYourTurnNotification(player) {
    let gamesSummary = await this.data.listMyTurnGamesSummary(player.id);

    /*
     * Exclude games the player is actively playing.
     */
    const sessionPlayer = GameSessionPlayer.cache.get(player);
    if (sessionPlayer) {
      const openedGamesById = sessionPlayer.openedGamesById;
      gamesSummary = gamesSummary.filter(gs => !openedGamesById.has(gs.id));
    }

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
      if (nextTeam.playerId === player.id) continue;

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
    const player = await this.auth.getPlayer(token.playerId);
    // Just in case this is a new player, load their default avatar so that it is saved without warnings.
    await this.data.getPlayerAvatars(player);
    // Did the connection close while fetching data?
    if (client.closed) return;

    const gameSession = GameSession.cache.use(client.id, () => GameSession.create(client.session, player));
    if (gameSession.player !== player)
      throw new ServerError(501, 'Unsupported change of player');

    gameSession.authorize(token);

    this._openAutoCancel(player.id);
    gameSession.session.once('close', () =>
      this.push.hasAnyPushSubscription(player.id).then(extended => this._closeAutoCancel(player.id, extended))
    );
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
    onGameEnd(game) {
      const sessionGame = GameSessionGame.cache.get(game);
      sessionGame.gameSessions.keys().forEach(gameSession => {
        gameSession.leaveGroup(`/games/${game.id}`)
        gameSession.closeGame(game);
      });

      this._emit({
        type: 'closeGroup',
        body: {
          group: `/games/${game.id}`,
        },
      });
    }
  */

  async onResetRatingsRequest(client, targetPlayerId, rankingId) {
    if (!GameSession.cache.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    if (process.env.NODE_ENV !== 'development') {
      const session = GameSession.cache.get(client.id);
      if (!session.player.identity.admin)
        throw new ServerError(403, 'You must be an admin to use this feature.');
    }

    const target = await this.auth.getPlayer(targetPlayerId);
    if (!target.verified)
      throw new ServerError(400, 'Player must be verified to reset ratings');

    const stats = await this.data.getPlayerStats(target);
    if (stats.ratings.size === 0)
      throw new ServerError(400, 'Player has no ratings to reset');

    stats.clearRatings(rankingId);
    target.identity.setRanks(targetPlayerId, stats.ratings);
  }
  async onGrantAvatarRequest(client, targetPlayerId, unitType) {
    if (!GameSession.cache.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    if (process.env.NODE_ENV !== 'development') {
      const session = GameSession.cache.get(client.id);
      if (!session.player.identity.admin)
        throw new ServerError(403, 'You must be an admin to use this feature.');
    }

    const target = await this.auth.getPlayer(targetPlayerId);
    const avatars = await this.data.getPlayerAvatars(target);
    avatars.addAvatar(unitType);
  }
  async onGrantUnitRequest(client, targetPlayerId, unitType) {
    if (!GameSession.cache.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    if (process.env.NODE_ENV !== 'development') {
      const session = GameSession.cache.get(client.id);
      if (!session.player.identity.admin)
        throw new ServerError(403, 'You must be an admin to use this feature.');
    }

    const target = await this.auth.getPlayer(targetPlayerId);
    const avatars = await this.data.getPlayerAvatars(target);
    avatars.addUnit(unitType);
  }

  /*
   * Create a new game and save it to persistent storage.
   */
  async onCreateGameRequest(client, gameTypeId, gameOptions) {
    const session = GameSession.cache.get(client.id);
    const creator = session.player;

    if (gameOptions.collection) {
      await this._validateCreateGameForCollection(gameTypeId, gameOptions);

      if (gameOptions.rated && !creator.verified)
        throw new ServerError(403, 'Guest accounts cannot create rated games');
    } else if (gameOptions.rated)
      throw new ServerError(403, 'Private games cannot be rated');

    const creatorTeam = gameOptions.teams.find(t => t?.playerId === creator.id);
    if (!creatorTeam)
      throw new ServerError(400, 'You must join games that you create');

    const isMultiplayer = gameOptions.teams.findIndex(t => t?.playerId !== creator.id) > -1;
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

    gameOptions.createdBy = creator.id;
    gameOptions.type = gameTypeId;

    const game = Game.create({
      ...gameOptions,
      teams: new Array(gameOptions.teams.length).fill(null),
    });
    const gameType = game.state.gameType = await this.data.getGameType(gameTypeId);

    for (const [slot, teamData] of gameOptions.teams.entries()) {
      if (!teamData) continue;

      teamData.slot = slot;

      if (teamData.playerId) {
        if (teamData.playerId === creator.id) {
          if (teamData.name !== undefined && teamData.name !== null && teamData.name !== creator.name)
            await Player.validatePlayerName(teamData.name, creator.identity);
        } else {
          const player = await this.auth.getPlayer(teamData.playerId);
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
      // The team hasn't joined the game yet if they are not the creator
      if (!teamData.playerId || teamData.playerId !== creator.id)
        team = Team.createReserve(teamData);
      // The team hasn't joined the game yet if they ARE the creator and haven't specified a set (e.g. single player games)
      else if (teamData.set === undefined && gameType.isCustomizable)
        team = Team.createReserve(teamData);
      else
        team = Team.createJoin(teamData, session, game);

      if (teamData.set)
        team.set = this.data.getTeamSet(teamData.set, gameType);

      await this._joinGame(game, team);
    }

    // Create the game before generating a notification to ensure it is accurate.
    await this._createGame(game);

    /*
     * Notify the player that goes first that it is their turn.
     * ...unless the player to go first just created the game.
     */
    if (game.state.startedAt)
      if (game.state.currentTeam.playerId !== creator.id)
        this._notifyYourTurn(game);

    return game.id;
  }
  async onTagGameRequest(client, gameId, tags) {
    const session = GameSession.cache.get(client.id);
    const game = await this._getGame(gameId);

    if (game.createdBy !== session.player.id)
      throw new ServerError(403, `May not tag someone else's game`);

    game.mergeTags(tags);
  }

  async onForkGameRequest(client, gameId, options) {
    this.debug(`forkGame: gameId=${gameId}; turnId=${options.turnId}, vs=${options.vs}, as=${options.as}`);

    if (![ 'yourself', 'same', 'invite' ].includes(options.vs)) {
      const player = await this.auth.getPlayer(options.vs);
      if (!player)
        throw new ServerError(409, `Team ${slot} has an unrecognized playerId`);
      options.vs = { playerId:player.id, name:player.name };
    }

    const session = GameSession.cache.get(client.id);
    const game = await this._getGame(gameId);
    const newGame = await this.data.forkGame(game, session, options);

    return newGame.id;
  }

  async onJoinGameRequest(client, gameId, teamData) {
    this.debug(`joinGame: gameId=${gameId}`);

    const session = GameSession.cache.get(client.id);
    const player = session.player;
    const game = await this._getGame(gameId);
    const gameType = await this.data.getGameType(game.state.type);
    const creator = await this.auth.getPlayer(game.createdBy);

    if (game.state.startedAt)
      throw new ServerError(409, 'The game has already started.');

    if (creator.hasBlocked(player, !!game.collection))
      throw new ServerError(403, 'You are blocked from joining this game.');

    if (teamData.name !== undefined && teamData.name !== null && teamData.name !== player.name)
      await Player.validatePlayerName(teamData.name, player.identity);

    if (game.collection) {
      const playerIds = new Set(game.state.teams.filter(t => t?.joinedAt).map(t => t.playerId));
      playerIds.add(player.id);

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

    let reservedSlot = teams.findIndex(t => !t?.joinedAt && t?.playerId === player.id);
    if (reservedSlot === -1) reservedSlot = null;

    // You may not join a game under more than one team
    // ...unless a slot was reserved for you, e.g. practice game.
    if (reservedSlot === null && teams.findIndex(t => t?.joinedAt && t.playerId === player.id) !== -1)
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
      team.join(teamData, session, game);
    else
      team = Team.createJoin(teamData, session, game);

    if (teamData.set)
      team.set = this.data.getTeamSet(teamData.set, gameType);

    await this._joinGame(game, team);

    /*
     * Notify the player that goes first that it is their turn.
     * ...unless the player to go first just joined.
     */
    if (game.state.startedAt)
      if (game.state.currentTeam.playerId !== player.id)
        this._notifyYourTurn(game);
  }

  async onCancelGameRequest(client, gameId) {
    this.debug(`cancelGame: gameId=${gameId}`);

    const session = GameSession.cache.get(client.id);
    const game = await this._getGame(gameId);
    if (session.player.id !== game.createdBy)
      throw new ServerError(403, `You cannot cancel other players' games`);

    game.cancel();
  }
  async onDeclineGameRequest(client, gameId) {
    this.debug(`declineGame: gameId=${gameId}`);

    const session = GameSession.cache.get(client.id);
    const game = await this._getGame(gameId);
    if (!game.state.getTeamForPlayer(session.player.id))
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

  async onGetDefaultSetRequest(client, gameTypeId) {
    return this.data.getDefaultSet(gameTypeId);
  }
  async onGetPlayerSetsRequest(client, gameTypeId) {
    const player = GameSession.cache.get(client.id).player;

    return this.data.getPlayerSets(player, gameTypeId);
  }
  async onGetPlayerSetRequest(client, gameTypeId, slot) {
    const player = GameSession.cache.get(client.id).player;

    return this.data.getPlayerSet(player, gameTypeId, slot);
  }
  async onSavePlayerSetRequest(client, gameTypeId, set) {
    const player = GameSession.cache.get(client.id).player;

    return this.data.setPlayerSet(player, gameTypeId, set);
  }
  async onDeletePlayerSetRequest(client, gameTypeId, slot) {
    const player = GameSession.cache.get(client.id).player;

    return this.data.unsetPlayerSet(player, gameTypeId, slot);
  }

  async onGetMyAvatarRequest(client) {
    const player = GameSession.cache.get(client.id).player;
    const playerAvatars = await this.data.getPlayerAvatars(player);

    return playerAvatars.avatar;
  }
  async onSaveMyAvatarRequest(client, avatar) {
    const player = GameSession.cache.get(client.id).player;
    const playerAvatars = await this.data.getPlayerAvatars(player);

    playerAvatars.avatar = avatar;
  }
  async onGetMyAvatarListRequest(client) {
    const player = GameSession.cache.get(client.id).player;
    const playerAvatars = await this.data.getPlayerAvatars(player);

    return playerAvatars.listAvatars;
  }
  async onGetMyUnitListRequest(client) {
    const player = GameSession.cache.get(client.id).player;
    const playerAvatars = await this.data.getPlayerAvatars(player);

    return playerAvatars.listUnits;
  }
  async onGetPlayersAvatarRequest(client, playerIds) {
    return this.data.listPlayersAvatar(playerIds);
  }

  async onGetGameRequest(client, gameId) {
    this.throttle(client.address, 'getGame');

    /*
     * When getting a game, leave out the turn history as an efficiency measure.
     */
    const player = GameSession.cache.get(client.id)?.player;
    const game = await this._getGame(gameId);

    const gameData = await game.getSyncForPlayer(player?.id);
    gameData.meta = await this._getGameMeta(game, player);

    return gameData;
  }
  async onGetGameTeamSetRequest(client, gameTypeId, gameId, teamId) {
    const player = GameSession.cache.get(client.id).player;

    return this.data.getGameTeamSet(gameTypeId, gameId, teamId, player);
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

    const session = GameSession.cache.get(client.id);
    if (!session.memberOf(groupPath))
      throw new ServerError(412, 'To get player status for this game, you must first join it');

    const game = Game.cache.get(gameId);
    const sessionGame = GameSessionGame.cache.get(game);
    return Array.from(sessionGame.playerStatus).map(([playerId, playerStatus]) => ({ playerId, ...playerStatus }));
  }
  async onGetPlayerActivityRequest(client, groupPath, forPlayerId) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const session = GameSession.cache.get(client.id);
    if (!session.memberOf(groupPath))
      throw new ServerError(412, 'To get player activity for this game, you must first join it');

    const game = Game.cache.get(gameId);
    if (!game)
      throw new ServerError(404, 'The game needs to be opened recently.');
    if (!game.state.startedAt)
      throw new ServerError(403, 'To get player activity for this game, the game must first start.');
    if (game.state.endedAt)
      throw new ServerError(403, 'May not get player activity for an ended game.');

    const inPlayerId = GameSession.cache.get(client.id).player.id;
    if (inPlayerId === forPlayerId)
      throw new ServerError(403, 'May not get player activity for yourself.');
    if (!game.state.teams.find(t => t.playerId === inPlayerId))
      throw new ServerError(403, 'To get player activity for this game, you must be a participant.');
    if (!game.state.teams.find(t => t.playerId === forPlayerId))
      throw new ServerError(403, 'To get player activity for this game, they must be a participant.');

    const forPlayer = await this.auth.getPlayer(forPlayerId);
    const sessionPlayer = GameSessionPlayer.cache.get(forPlayer);
    const playerActivity = {
      generalStatus: 'offline',
      gameStatus: 'closed',
      idle: this._getPlayerIdle(forPlayer),
      gameIdle: this._getPlayerGameIdle(forPlayerId, game),
    };

    if (sessionPlayer) {
      playerActivity.generalStatus = playerActivity.idle > ACTIVE_LIMIT ? 'inactive' : 'active';
      playerActivity.gameStatus = sessionPlayer.openedGamesById.has(gameId)
        ? playerActivity.gameIdle > ACTIVE_LIMIT ? 'inactive' : 'active'
        : 'closed';
      playerActivity.activity = this._getPlayerActivity(forPlayer, gameId, inPlayerId);
    }

    return playerActivity;
  }
  async onGetPlayerInfoRequest(client, groupPath, vsPlayerId) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const session = GameSession.cache.get(client.id);
    if (!session.memberOf(groupPath))
      throw new ServerError(412, 'To get player activity for this game, you must first join it');

    const game = Game.cache.get(gameId);
    if (!game.state.startedAt)
      throw new ServerError(403, 'To get player info for this game, the game must first start.');

    const myPlayerId = GameSession.cache.get(client.id).player.id;
    if (myPlayerId === vsPlayerId)
      throw new ServerError(403, 'May not get player info for yourself.');

    const team = game.state.teams.find(t => t.playerId === vsPlayerId);
    if (!team)
      throw new ServerError(403, 'To get player info for this game, they must be a participant.');

    const me = session.player;
    const vsStats = (await this.data.getPlayerStats(me, [ vsPlayerId ])).getVS(team);

    const gameTypesById = await this.data.getGameTypesById();
    const them = await this.auth.getPlayer(vsPlayerId);
    const ranks = them.identity.getRanks();
    const themStats = await this.data.getPlayerStats(them);
    const teamSet = game.isFork ? null : await this.data.getGameTeamSet(game.state.gameType, game.id, team.id);

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
          // An alias name is always expected to exist, but due to bugs...
          .filter(a => a.name && a.name.toLowerCase() !== team.name.toLowerCase())
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
      set: teamSet && Object.assign({
        via: team.setVia,
        randomSide: team.randomSide,
      }, teamSet),
    };
  }
  async onGetMyInfoRequest(client, gameId, teamId) {
    const playerId = GameSession.cache.get(client.id).player.id;
    const player = await this.auth.getPlayer(playerId);

    const game = await Game.cache.peek(gameId);
    if (!game.state.startedAt)
      throw new ServerError(403, 'To get player info for this game, the game must first start.');

    const team = game.state.teams[teamId];
    if (team.playerId !== playerId)
      throw new ServerError(403, 'You are not the owner of this team.');

    const ranks = player.identity.getRanks();
    const gameTypesById = await this.data.getGameTypesById();
    const myStats = await this.data.getPlayerStats(player);
    const teamSet = game.isFork ? null : await this.data.getGameTeamSet(game.state.gameType, gameId, teamId);

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
      set: teamSet && Object.assign({
        via: team.setVia,
        randomSide: team.randomSide,
      }, teamSet),
    };
  }
  async onClearWLDStatsRequest(client, vsPlayerId, gameTypeId) {
    const player = GameSession.cache.get(client.id).player;
    await this.data.clearPlayerWLDStats(player, vsPlayerId, gameTypeId);
  }

  async onSearchMyGamesRequest(client, query) {
    const player = GameSession.cache.get(client.id).player;
    return this._searchPlayerGames(player, query);
  }
  async onSearchGameCollectionRequest(client, collectionId, query) {
    if (!this.collections.has(collectionId))
      throw new ServerError(400, 'Unrecognized game collection');

    const player = GameSession.cache.get(client.id).player;

    return this._searchGameCollection(player, collectionId, query);
  }
  async onGetRatedGamesRequest(client, rankingId, playerId) {
    const player = GameSession.cache.get(client.id).player;
    const gamesSummary = playerId
      ? await this.data.getPlayerRatedGames(playerId, rankingId)
      : await this.data.getRatedGames(rankingId);

    return Promise.all(Array.from(gamesSummary.values()).map(gs => this._cloneGameSummaryWithMeta(gs, player)));
  }
  async onSearchTeamSetsRequest(client, gameTypeId, options) {
    if ((options.limit ?? 20) > 100)
      throw new ServerError(403, 'The limit may not exceed 100');

    return this.data.searchTeamSets(gameTypeId, options);
  }
  async onSearchTeamSetGamesRequest(client, gameTypeId, options) {
    if ((options.limit ?? 20) > 100)
      throw new ServerError(403, 'The limit may not exceed 100');

    const player = GameSession.cache.get(client.id).player;
    const result = await this.data.searchTeamSetGames(gameTypeId, options);
    result.gamesSummary = await Promise.all(result.gamesSummary.map(gs => this._cloneGameSummaryWithMeta(gs, player)));

    return result;
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
    const session = GameSession.cache.get(client.id);
    const player = session.player;

    const game = await this._getGame(gameId);
    // Abort if the client is no longer connected.
    if (client.closed) return;

    session.joinGroup(groupPath);

    const sync = game.getSyncForPlayer(player.id, reference);
    const sessionGame = session.openGame(game, sync.reference ?? reference);

    for (const team of game.state.teams)
      if (team?.playerId === player.id)
        game.checkin(team);

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: player.id,
          name: player.name,
        },
      },
    });

    return {
      playerStatus: Array.from(sessionGame.playerStatus)
        .map(([playerId, playerStatus]) => ({ playerId, ...playerStatus })),
      sync,
    };
  }
  async onJoinMyGamesGroup(client, groupPath, playerId, params) {
    const session = GameSession.cache.get(client.id);
    const player = session.player;
    if (playerId !== player.id)
      throw new ServerError(403, 'You may not join other player game groups');

    const playerGames = await this.data.getPlayerGames(playerId);
    const results = await (() => {
      if (!params.query) return;
      return this._searchPlayerGames(player, params.query);
    })();

    // Abort if the client is no longer connected.
    if (client.closed) return;

    const filters = [];
    if (params.query)
      if (Array.isArray(params.query))
        filters.push(params.query.map(q => q.filter));
      else
        filters.push(params.query.filter);
    else if (params.filter)
      filters.push(params.filter);

    session.joinGroup(groupPath);
    const gslGroup = session.openGameSummaryListGroup(groupPath, [ playerGames ], filters);

    const response = {
      stats: gslGroup.stats.get(playerGames.id),
    };
    if (results)
      response.results = results;

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: player.id,
          name: player.name,
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
    const session = GameSession.cache.get(client.id);
    const player = session.player;
    const collectionGroups = this.collectionGroups;
    const collectionIds = [];

    if (groupPath === '/collections')
      collectionIds.push(...this.collections.keys());
    else if (collectionGroups.has(collectionId))
      collectionIds.push(...collectionGroups.get(collectionId));
    else
      throw new ServerError(404, 'No such collection');

    const collections = await Promise.all(collectionIds.map(cId => this.data.getGameCollection(cId)));
    const results = new Map(await (() => {
      if (!params.query) return;
      return Promise.all(collections.map(async c => [ c.id, await this._searchGameCollection(player, c.id, params.query) ]));
    })());

    // Abort if the client is no longer connected.
    if (client.closed) return;

    const filters = [];
    if (params.query)
      if (Array.isArray(params.query))
        filters.push(params.query.map(q => q.filter));
      else
        filters.push(params.query.filter);
    else if (params.filter)
      filters.push(params.filter);

    session.joinGroup(groupPath);
    const gslGroup = session.openGameSummaryListGroup(groupPath, collections, filters);
    const response = { stats:gslGroup.stats };
    if (results)
      response.results = results;

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: player.id,
          name: player.name,
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
      const creator = await this.auth.getPlayer(data.createdBy);
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

    const playerIds = Array.from(new Set(data.teams.filter(t => t?.playerId).map(t => t.playerId)));
    const rankingIds = [ 'FORTE', game.type ];

    promises.push(this.auth.getPlayerRanks(playerIds, rankingIds).then(ranksByPlayerId => {
      meta.ranks = data.teams.map(t => {
        if (!t?.playerId) return null;

        return ranksByPlayerId.get(t.playerId);
      });
    }));

    if (player)
      promises.push(this.data.getPlayerSets(player, data.type).then(sets => {
        meta.setNames = data.teams.map(t => {
          if (!t || !t.set) return null;

          return sets.find(s => s.id === t.set.id)?.name ?? null;
        });
      }));

    await Promise.all(promises);

    return meta;
  }
  async _cloneGameSummaryWithMeta(gameSummary, player) {
    const gameSummaryWithMetaCache = gameSummaryWithMetaCacheByPlayer.get(player) ?? new WeakMap();
    gameSummaryWithMetaCacheByPlayer.set(player, gameSummaryWithMetaCache);

    if (!gameSummaryWithMetaCache.has(gameSummary))
      gameSummaryWithMetaCache.set(gameSummary, gameSummary.cloneWithMeta(await this._getGameMeta(gameSummary, player), player));
    return gameSummaryWithMetaCache.get(gameSummary);
  }

  _attachGame(game) {
    if (this.attachedGames.has(game))
      return;
    this.attachedGames.add(game);

    const state = this.data.state;

    if (!game.state.startedAt) {
      game.state.once('startGame', () => this._recordGameStats(game));

      if (game.collection && game.state.timeLimit.base < 86400) {
        state.autoCancel.open(game.id, true);
        game.state.once('startGame', () => state.autoCancel.delete(game.id));
        game.on('delete', () => state.autoCancel.delete(game.id));
      }
    }

    if (!game.state.endedAt)
      game.state.once('endGame', () => this._recordGameStats(game));

    this._syncAutoSurrender(game);

    game.state.on('willSync', ({ data:expireIn }) => {
      state.willSync.add(game.id, true, expireIn);
    });
    game.state.on('sync', ({ data:event }) => {
      this._syncAutoSurrender(game);
      state.willSync.delete(game.id);

      // Send notification, if needed, to the current player
      // Only send a notification after the first playable turn
      // This is because notifications are already sent elsewhere on game start.
      if (event.type === 'startTurn' && event.data.startedAt > game.state.startedAt)
        this._notifyYourTurn(game);
    });
    game.on('delete', event => {
      const reason = event.type.slice(7);
      const sessionGame = GameSessionGame.cache.get(game);
      if (sessionGame)
        for (const gameSession of sessionGame.gameSessions.keys())
          this.onLeaveGameGroup(gameSession.session.client, `/games/${game.id}`, game.id, reason);

      this.data.deleteGame(game).then(event.whenDeleted.resolve, event.whenDeleted.reject);
    });
  }
  async _recordGameStats(game) {
    if (game.state.isSinglePlayer) return;

    const playerIds = Array.from(new Set([ ...game.state.teams.map(t => t.playerId) ]));
    const players = await Promise.all(playerIds.map(pId => this.auth.getPlayer(pId)));
    const playersStats = await Promise.all(players.map(p => this.data.getPlayerStats(p, playerIds)));
    const playersMap = new Map(players.map(p => [ p.id, p ]));
    const playersStatsMap = new Map(playersStats.map(ps => [ ps.playerId, ps ]));

    if (game.state.endedAt) {
      // Make sure stats are loaded
      await Promise.all(game.state.teams.map(t => this.data.getTeamSetStats(t.set, t.playerId)));

      if (game.state.rated) {
        const slowMode = await this.data.getGameSlowMode(game, ...players);
        if (PlayerStats.updateRatings(game, playersStatsMap, slowMode))
          for (const playerStats of playersStats)
            playersMap.get(playerStats.playerId).identity.setRanks(playerStats.playerId, playerStats.ratings);
        TeamSet.applyGame(game);
      } else
        TeamSet.applyGame(game);

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
    if (game.state.endedAt) {
      this.data.state.autoSurrender.delete(game.id);
      return;
    }

    // Allow the current turn in games to have at least 5 minutes remaining from the point of server startup.
    if (
      // The current turn must have started before server startup
      game.state.currentTurn.startedAt < this.startupAt &&
      // The time limit must be less than 5 minutes.
      game.state.timeLimit.base < 300 &&
      // The server must have started less than 5 minutes ago.
      (Date.now() - this.startupAt) < 300000
    ) {
      game.state.currentTurn.resetTimeLimit(Math.ceil((300000 - (Date.now() - this.startupAt)) / 1000));
      this._notifyYourTurn(game);
    }

    this.data.state.autoSurrender.add(game.id, true, game.state.getTurnTimeRemaining());
  }

  /*
   * This is triggered by player checkin / checkout events.
   * On checkin, open games will not be auto cancelled.
   * On checkout, open games will auto cancel after a period of time.
   * That period of time is 1 hour if they have push notifications enabled.
   * Otherwise, the period of time is based on game turn time limit.
   * 
   * Note that the autoCancel Timeout instance uses an open counter to handle
   * cases where a player might check in with more than one session.  So, auto
   * cancel will only kick in after ALL sessions are closed.
   */
  async _closeAutoCancel(playerId, extended = false) {
    const autoCancel = this.data.state.autoCancel;
    for (const game of await this._getGames(autoCancel.openedKeys()))
      if (game.createdBy === playerId)
        autoCancel.close(game.id, (extended ? 3600 : game.state.timeLimit.initial) * 1000);
  }
  async _openAutoCancel(playerId) {
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

  /*
   * No longer send change events to the client about this game.
   * Only called internally since the client does not yet leave intentionally.
   */
  onLeaveGameGroup(client, groupPath, gameId, reason) {
    const game = Game.cache.get(gameId);
    const session = GameSession.cache.get(client.id);
    session.leaveGroup(groupPath);
    session.closeGame(game);

    const player = session.player;
    const checkoutAt = new Date();
    const lastActiveAt = new Date(checkoutAt - client.session.idle * 1000);
    for (const team of game.state.teams)
      if (team?.playerId === player.id)
        game.checkout(team, checkoutAt, lastActiveAt);

    this._emit({
      type: 'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: player.id,
          name: player.name,
        },
        reason,
      },
    });
  }
  onLeaveMyGamesGroup(client, groupPath, playerId) {
    const session = GameSession.cache.get(client.id);
    const player = session.player;
    session.leaveGroup(groupPath);
    session.closeGameSummaryListGroup(groupPath);

    this._emit({
      type: 'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: player.id,
          name: player.name,
        },
      },
    });
  }
  onLeaveCollectionGroup(client, groupPath, collectionId) {
    const session = GameSession.cache.get(client.id);
    const player = session.player;
    session.leaveGroup(groupPath);
    session.closeGameSummaryListGroup(groupPath);

    this._emit({
      type: 'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: player.id,
          name: player.name,
        },
      },
    });
  }

  onActionRequest(client, groupPath, action) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const session = GameSession.cache.get(client.id);
    if (!session.memberOf(groupPath))
      throw new ServerError(412, 'You must first join the game group');

    const player = session.player;
    const game = Game.cache.get(gameId);

    game.submitAction(player.id, action);
  }
  onPlayerRequestRequest(client, groupPath, requestType, receivedAt) {
    const gameId = groupPath.replace(/^\/games\//, '');

    const session = GameSession.cache.get(client.id);
    if (!session.memberOf(groupPath))
      throw new ServerError(412, 'You must first join the game group');

    const player = session.player;
    const game = Game.cache.get(gameId);

    game.submitPlayerRequest(player.id, requestType, receivedAt);
  }

  onPlayerRequestAcceptEvent(client, groupPath, createdAt) {
    const gameId = groupPath.replace(/^\/games\//, '');
    const player = GameSession.cache.get(client.id).player;
    const game = Game.cache.get(gameId);

    game.acceptPlayerRequest(player.id, createdAt);
  }
  onPlayerRequestRejectEvent(client, groupPath, createdAt) {
    const gameId = groupPath.replace(/^\/games\//, '');
    const player = GameSession.cache.get(client.id).player;
    const game = Game.cache.get(gameId);

    game.rejectPlayerRequest(player.id, createdAt);
  }
  onPlayerRequestCancelEvent(client, groupPath, createdAt) {
    const gameId = groupPath.replace(/^\/games\//, '');
    const player = GameSession.cache.get(client.id).player;
    const game = Game.cache.get(gameId);

    game.cancelPlayerRequest(player.id, createdAt);
  }

  /*******************************************************************************
   * Helpers
   ******************************************************************************/
  async _searchPlayerGames(player, query) {
    const result = await this.data.searchPlayerGames(player, query);
    return this._applyMetaToSearchResult(player, query, result);
  }
  async _searchGameCollection(player, collectionId, query) {
    const result = await this.data.searchGameCollection(player, collectionId, query, pId => this.auth.getPlayer(pId));
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

  async _resolveTeamSet(game, team) {
    const gameType = game.state.gameType;
    if (team.setVia === 'top') {
      const playerSet = await this.data.getDefaultSet(gameType.id);
      team.set = this.data.getTeamSet(playerSet, gameType);
    } else if (team.setVia === 'same') {
      const firstTeam = game.state.teams.filter(t => t?.joinedAt).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (!firstTeam)
        throw new ServerError(400, `Can't use same set when nobody has joined yet.`);
      team.set = firstTeam.set.clone();
    } else if (team.setVia === 'mirror') {
      const firstTeam = game.state.teams.filter(t => t?.joinedAt).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (!firstTeam)
        throw new ServerError(400, `Can't use mirror set when nobody has joined yet.`);
      team.set = firstTeam.set.clone('mirror');
    } else if (team.setVia === 'random') {
      const player = await this.auth.getPlayer(team.playerId);
      const playerSet = (await this.data.getPlayerSets(player, gameType)).random();
      team.set = this.data.getTeamSet(playerSet, gameType);
    } else {
      const player = await this.auth.getPlayer(team.playerId);
      const playerSet = await this.data.getPlayerSet(player, gameType, team.setVia);
      if (playerSet === null)
        throw new ServerError(412, 'Sorry!  Looks like the set no longer exists.');
      team.set = this.data.getTeamSet(playerSet, gameType);
    }

    try {
      gameType.validateSet({ units:team.set.units });
    } catch (e) {
      console.log('_resolveTeamSet: validateSet: Error', e);
      throw new ServerError(403, `This set cannot be used in the ${gameType.name} style.`);
    }

    if (team.randomSide && Math.random() < 0.5)
      team.set.flipSide();
  }
  async _joinGame(game, team) {
    if (team.setVia && team.setVia !== 'temp')
      await this._resolveTeamSet(game, team);

    game.state.join(team);

    const teams = game.state.teams;

    if (teams.findIndex(t => !t?.joinedAt) === -1) {
      const playerIds = new Set(teams.map(t => t.playerId));
      if (playerIds.size > 1) {
        if (game.rated === null) {
          const players = await Promise.all([ ...playerIds ].map(pId => this.auth.getPlayer(pId)));
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

  /*
   * There is a tricky thing here.  It is possible that a player checked in with
   * multiple clients, but the most recently active client checked out first.
   * In that case, show the idle time based on the checked out client rather
   * than the longer idle times of client(s) still checked in.
   */
  _getPlayerIdle(player) {
    const idle = Math.floor((new Date() - player.checkoutAt) / 1000);

    const sessionPlayer = GameSessionPlayer.cache.get(player);
    if (sessionPlayer)
      return sessionPlayer.idle;

    return idle;
  }
  _getPlayerGameIdle(playerId, game) {
    const team = game.state.teams.find(t => t.playerId === playerId);
    const gameIdle = Math.floor((new Date() - (team.lastActiveAt ?? team.joinedAt)) / 1000);

    const player = Player.cache.get(playerId);
    if (!player) return gameIdle;

    const sessionPlayer = GameSessionPlayer.cache.get(player);
    if (!sessionPlayer) return gameIdle;

    const openedGames = sessionPlayer.openedGames;
    if (!openedGames.has(game)) return gameIdle;

    const sessions = openedGames.get(game);
    return Math.min(gameIdle, ...Array.from(sessions).map(s => s.session.idle));
  }
  _getPlayerActivity(player, fromGameId, inPlayerId) {
    // The player must be online
    const sessionPlayer = GameSessionPlayer.cache.get(player);
    if (!sessionPlayer) return;

    // Get a list of games in which the player is participating and has opened.
    // Sort the games from most active to least.
    const openGamesInfo = [...sessionPlayer.openedGames.keys()]
      .filter(game =>
        game.state.startedAt && !game.state.endedAt &&
        game.state.teams.some(t => t.playerId === player.id)
      )
      .map(game => ({ game, idle:this._getPlayerGameIdle(player.id, game) }))
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
    const player = await this.auth.getPlayer(game.state.currentTeam.playerId);
    const gameSession = GameSessionGame.cache.get(game);

    if (gameSession) {
      // If the player is currently active in game, no notification required (yet)
      // We might still notify them if they close the game without any activity.
      const playerStatus = gameSession.playerStatus.get(player.id);
      if (playerStatus.status === 'active')
        return false;

      // Also don't notify if the player has been active in the game since turn started.
      const elapsed = Date.now() - game.currentTurn.startedAt;
      const idle = gameSession.getPlayerIdle(player);
      if (idle < elapsed)
        return false;
    }

    const notification = await this.getYourTurnNotification(player);
    // Game count should always be >= 1, but just in case...
    if (notification.gameCount === 0)
      return true;

    const urgency = game.state.rated === true && game.state.timeLimit.base < 86400 ? 'high' : 'normal';

    this.push.pushNotification(player.id, notification, urgency);

    return true;
  }
}
