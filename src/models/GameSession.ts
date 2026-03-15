// @ts-ignore
import uaparser from 'ua-parser-js';

import type Game from '#models/Game.js';
import type GameSummary from '#models/GameSummary.js';
import type GameSummaryList from '#models/GameSummaryList.js';
import { type GameEvents } from '#models/Game.js';
import type { Reference } from '#models/Game.js';
import Player from '#models/Player.js';
import type Session from '#models/Session.js';
// @ts-ignore
import type AccessToken from '#server/AccessToken.js';
import Cache from '#utils/Cache.js';
import { TypedEmitter, type NamespaceEventMap } from '#utils/emitter.js';
// @ts-ignore
import { test } from '#utils/jsQuery.js';

const ACTIVE_LIMIT = 120;

export default class GameSession {
  protected static _cache: Cache<string, GameSession>;

  protected data: {
    joinedGroups: Set<string>;
    openedGames: Set<Game>;
    openedGameSummaryListGroups: Set<GameSessionGameSummaryListGroup>,
    deviceType: 'mobile' | string;
  };
  private _session: Session;
  private _token: AccessToken;
  private _player: Player;

  constructor(session:Session, player:Player) {
    this._session = session;
    this._player = player;
    this.data = {
      joinedGroups: new Set(),
      // Typically, a given session can only have one open game at any given point in time.
      // But a given player might have the same game opened in 2 sessions.
      // So, to determine if a player is idle, you need to only look at the sessions in which that player has opened the game.
      openedGames: new Set(),
      openedGameSummaryListGroups: new Set(),
      deviceType: uaparser(session.client.agent).device.type,
    };

    const sessionPlayer = GameSessionPlayer.cache.use(player, () => GameSessionPlayer.create(player));
    sessionPlayer.addSession(this);

    session.on('change:idle', this._onIdleChange.bind(this));

    return this;
  }

  static get cache() {
    return this._cache ??= new Cache({ ttl:null });
  }
  static create(session:Session, player:Player) {
    return this.cache.use(session.id, new GameSession(session, player));
  }

  get session() {
    return this._session;
  }
  get token() {
    return this._token;
  }
  get player() {
    return this._player;
  }
  get playerSession() {
    return GameSessionPlayer.cache.get(this._player)!;
  }
  get name() {
    return this._token.playerName;
  }
  get openedGames() {
    return this.data.openedGames;
  }
  get isMobile() {
    return this.data.deviceType === 'mobile';
  }

  authorize(token:AccessToken) {
    this._token = token;
  }
  joinGroup(groupPath:string) {
    this.data.joinedGroups.add(groupPath);
  }
  leaveGroup(groupPath:string) {
    this.data.joinedGroups.delete(groupPath);
  }
  memberOf(groupPath:string) {
    return this.data.joinedGroups.has(groupPath);
  }

  openGame(game:Game, reference:Reference) {
    this.data.openedGames.add(game);

    const sessionGame = GameSessionGame.cache.use(game, () => GameSessionGame.create(game));
    sessionGame.addSession(this, reference);
    return sessionGame;
  }
  closeGame(game:Game) {
    this.data.openedGames.delete(game);

    const sessionGame = GameSessionGame.cache.get(game)!;
    sessionGame.dropSession(this);
  }

  openGameSummaryListGroup(groupPath:string, gsls:GameSummaryList[], filters:Record<string, any>[]) {
    const gsgslg = GameSessionGameSummaryListGroup.register(this, groupPath, gsls, filters);
    this.data.openedGameSummaryListGroups.add(gsgslg);
    return gsgslg;
  }
  closeGameSummaryListGroup(groupPath:string) {
    const gsgslg = GameSessionGameSummaryListGroup.unregister(this, groupPath);
    this.data.openedGameSummaryListGroups.delete(gsgslg);
  }

  _onIdleChange({ data:{ newValue, oldValue } }:{ data:{ newValue:number, oldValue:number } }) {
    const newInactive = newValue > ACTIVE_LIMIT;
    const oldInactive = oldValue > ACTIVE_LIMIT;
    if (newInactive === oldInactive) return;

    for (const game of this.openedGames)
      GameSessionGame.cache.get(game)!.emitPlayerStatus(this._player.id);
  }
};

/*
 * Every GameSessionPlayer represents a player that is currently connected to the game service.
 * They are connected via one or more game sessions.
 */
export class GameSessionPlayer {
  private static _cache: Cache<Player, GameSessionPlayer>;

  protected data: {
    player: Player,
    gameSessions: Set<GameSession>,
  };

  constructor(player:Player) {
    this.data = {
      player,
      gameSessions: new Set(),
    };
  }

  static get cache() {
    return this._cache ??= new Cache({ ttl:null });
  }
  static create(player:Player) {
    return this.cache.set(player, () => new GameSessionPlayer(player));
  }

  /*
   * There is a tricky thing here.  It is possible that a player checked in with
   * multiple clients, but the most recently active client checked out first.
   * In that case, show the idle time based on the checked out client rather
   * than the longer idle times of client(s) still checked in.
   */
  get idle() {
    const idle = Math.floor((Date.now() - this.data.player.checkoutAt.getTime()) / 1000);

    return Math.min(idle, ...Array.from(this.data.gameSessions).map(gs => gs.session.idle));
  }
  get openedGames() {
    const openedGames = new Map<Game, Set<GameSession>>();
    for (const gameSession of this.data.gameSessions)
      for (const game of gameSession.openedGames)
        if (openedGames.has(game))
          openedGames.get(game)!.add(gameSession);
        else
          openedGames.set(game, new Set([ gameSession ]));

    return openedGames;
  }
  get openedGamesById() {
    const openedGames = new Map<string, Game>();
    for (const gameSession of this.data.gameSessions)
      for (const game of gameSession.openedGames)
        openedGames.set(game.id, game);

    return openedGames;
  }
  get isMobile() {
    return Array.from(this.data.gameSessions).some(s => s.isMobile);
  }

  addSession(gameSession:GameSession) {
    this.data.gameSessions.add(gameSession);
    gameSession.session.once('close', () => this.dropSession(gameSession));

    // The player gains an online status if this is their only session.
    if (this.data.gameSessions.size === 1)
      this._onChangePlayerStatus();
  }
  dropSession(gameSession:GameSession) {
    this.data.gameSessions.delete(gameSession);
    // The player might become offline if this was their only session.
    if (this.data.gameSessions.size === 0) {
      GameSessionPlayer.cache.delete(this.data.player);
      this._onChangePlayerStatus();
    }
  }

  _onChangePlayerStatus() {
    // Iterate on all open games since this player might be a participant in a
    // game that is opened by somebody else but not by this player.  This allows
    // them to see if this player is online or offline.
    const playerId = this.data.player.id;
    for (const gameSession of GameSessionGame.cache.values())
      if (gameSession.game.state.teams.some(t => t?.playerId === playerId))
        gameSession.emitPlayerStatus(playerId);
  }
};

type PlayerStatus = {
  status: 'offline' | 'online' | 'active';
  deviceType?: 'mobile' | undefined;
  isOpen?: true;
};
type EmittedPlayerStatus = {
  oldValue: { playerId:string } & PlayerStatus,
  newValue: { playerId:string } & PlayerStatus,
};
type WithTarget<EventMap extends { [K in keyof EventMap]: object }, Prefix extends string, Target> = {
  [K in keyof NamespaceEventMap<EventMap, Prefix>]: { target:Target } & NamespaceEventMap<EventMap, Prefix>[K];
};
type GameSessionGameStaticEvents = {
  'playerStatus': { target:GameSessionGame, data:EmittedPlayerStatus },
  'sync': { target:GameSessionGame, clientId:string, data:any },
} & WithTarget<GameEvents, 'playerRequest', GameSessionGame>;
const gameSessionGameEmitter = new TypedEmitter<GameSessionGameStaticEvents>();

/*
 * Keep track of which games are currently opened by at least one player.
 */
export class GameSessionGame {
  protected static _cache: Cache<Game, GameSessionGame>;

  protected data: {
    game: Game,
    gameSessions: Map<GameSession, Reference>,
    playerStatus: Map<string, PlayerStatus>,
  };

  constructor(game:Game) {
    this.data = {
      game,
      gameSessions: new Map(),
      playerStatus: new Map(),
    };

    const teamPlayerIds = new Set(game.state.teams.filter(t => t?.joinedAt).map(t => t!.playerId));
    for (const playerId of teamPlayerIds)
      this.data.playerStatus.set(playerId, this._getPlayerStatus(playerId));

    /*
     * A context of 'this' is provided so that we can remove listeners when this object is removed
     * from the cache.  The reason we must remove games from the cache is so that we know which
     * games are actually open without having to filter the list to those with a positive session
     * count.  GameSessionPlayer._onChangePlayerStatus() is an example of this.
     */
    game.on('playerRequest', event => GameSessionGame.emit(Object.assign({ target:this }, event)), this);
    game.state.on('sync', () => this.sync(), this);
    game.state.on('join', ({ data:team }) => this.emitPlayerStatus(team.playerId), this);
  }

  static get cache() {
    return this._cache ??= new Cache({ ttl:null });
  }
  static create(game:Game) {
    return this.cache.set(game, () => new GameSessionGame(game));
  }
  static on(...args:Parameters<typeof gameSessionGameEmitter.on>) {
    gameSessionGameEmitter.on(...args);
  }
  static once(...args:Parameters<typeof gameSessionGameEmitter.once>) {
    gameSessionGameEmitter.once(...args);
  }
  static off(...args:Parameters<typeof gameSessionGameEmitter.off>) {
    gameSessionGameEmitter.off(...args);
  }
  static emit(...args:Parameters<typeof gameSessionGameEmitter.emit>) {
    gameSessionGameEmitter.emit(...args);
  }

  get game() {
    return this.data.game;
  }
  get playerStatus() {
    return this.data.playerStatus;
  }

  getPlayerIdle(playerId:string) {
    const idles = [];
    for (const gameSession of this.data.gameSessions.keys())
      if (gameSession.player.id === playerId)
        idles.push(gameSession.session.idle);

    if (idles.length === 0) return null;
    return Math.min(...idles);
  }
  addSession(gameSession:GameSession, reference:Reference) {
    this.data.gameSessions.set(gameSession, reference);
    // Only emit if others might see
    if (this.data.gameSessions.size > 1) {
      // The player might become active
      this.emitPlayerStatus(gameSession.player.id);
    }
  }
  dropSession(gameSession:GameSession) {
    this.data.gameSessions.delete(gameSession);
    if (this.data.gameSessions.size === 0) {
      this.data.game.removeAllListeners(undefined, this);
      this.data.game.state.removeAllListeners(undefined, this);
      GameSessionGame.cache.delete(this.data.game);
    } else {
      // The player might become online or inactive
      this.emitPlayerStatus(gameSession.player.id);
    }
  }
  sync() {
    const { game, gameSessions } = this.data;

    for (const [ gameSession, reference ] of gameSessions.entries()) {
      const sync = game.getSyncForPlayer(gameSession.player.id, reference);
      if (!sync.reference)
        continue;

      // playerRequest is synced elsewhere
      delete sync.playerRequest;

      gameSessions.set(gameSession, sync.reference);
      GameSessionGame.emit('sync', { target:this, clientId:gameSession.session.id, data:sync });
    }
  }

  /*
   * Trigger an event in these situations:
   * 1) When a participant joins the game.
   * 2) When a participant opens the game.
   * 3) When a participant closes the game.
   * 4) When a participant becomes inactive while they have the game open.
   * 5) When a participant becomes active while they have the game open.
   * 
   * When the GameSessionGame instance is created by a participant or observer opening the game, an event need not be sent.
   * This is because playerStatus is merely initialized and sent as a response to the joinGameGroup request.
   */
  emitPlayerStatus(forPlayerId:string) {
    const { game, playerStatus } = this.data;
    const teamPlayerIds = new Set(game.state.teams.filter(t => t?.joinedAt).map(t => t!.playerId));

    for (const playerId of teamPlayerIds) {
      if (forPlayerId !== playerId) continue;

      const oldPlayerStatus = playerStatus.get(playerId) ?? { status:'offline' };
      const newPlayerStatus = this._getPlayerStatus(playerId);
      if (
        newPlayerStatus.status !== oldPlayerStatus?.status ||
        newPlayerStatus.deviceType !== oldPlayerStatus?.deviceType
      ) {
        playerStatus.set(playerId, newPlayerStatus);
        GameSessionGame.emit('playerStatus', {
          target: this,
          data: {
            oldValue: { playerId, ...oldPlayerStatus },
            newValue: { playerId, ...newPlayerStatus },
          },
        });
      }
    }
  }
  _getPlayerStatus(playerId:string):PlayerStatus {
    const { game } = this.data;
    const player = Player.cache.get(playerId);
    if (!player)
      return { status:'offline' as const };

    const sessionPlayer = GameSessionPlayer.cache.get(player);
    if (!sessionPlayer || (game.state.endedAt && !sessionPlayer.openedGames.has(game)))
      return { status:'offline' as const };

    const deviceType = sessionPlayer.isMobile ? 'mobile' as const : undefined;

    if (!sessionPlayer.openedGames.has(game))
      return { status: 'online' as const, deviceType };

    /*
     * Determine active status with the minimum idle of all clients this player
     * has connected to this game.
     */
    const gameSessions = Array.from(sessionPlayer.openedGames.get(game)!);
    const idle = Math.min(...gameSessions.map(gs => gs.session.idle));

    return {
      status: idle > ACTIVE_LIMIT ? 'online' as const : 'active' as const,
      deviceType,
      isOpen: true as const,
    };
  }
};

/*
 * A session can only open a given game summary list once.
 * But they may filter that list to multiple subsets.
 */
type GameSummaryListStats = {
  waiting: number,
  active: number,
};
type GameSessionGameSummaryListStaticEvents = {
  'game:add': {
    target: GameSessionGameSummaryListGroup,
    gameSummaryList: GameSummaryList,
    gameSummary: GameSummary,
  },
  'game:change': {
    target: GameSessionGameSummaryListGroup,
    gameSummaryList: GameSummaryList,
    gameSummary: GameSummary,
  },
  'game:remove': {
    target: GameSessionGameSummaryListGroup,
    gameSummaryList: GameSummaryList,
    gameSummary: GameSummary,
  },
  'stats': {
    target: GameSessionGameSummaryListGroup,
    gameSummaryList: GameSummaryList,
    stats: GameSummaryListStats,
  },
};
const gameSessionGameSummaryListGroupEmitter = new TypedEmitter<GameSessionGameSummaryListStaticEvents>();

export class GameSessionGameSummaryListGroup {
  protected static _cache: Cache<string, GameSessionGameSummaryListGroup>;

  protected data: {
    gameSession: GameSession,
    groupPath: string,
    filters: Record<string, any>[] | null,
    gameSummaryLists: GameSummaryList[],
    stats: Map<GameSummaryList, GameSummaryListStats>,
  };

  constructor(gameSession:GameSession, groupPath:string, gameSummaryLists:GameSummaryList[], filters:Record<string, any>[]) {
    this.data = { gameSession, groupPath, filters, gameSummaryLists, stats:new Map() };

    for (const gsl of gameSummaryLists) {
      this.data.stats.set(gsl, this._getStats(gsl));
      gsl.on('change', this._onChangeGameSummaryList.bind(this, gsl), this);
    }
  }

  static get cache() {
    return this._cache ??= new Cache({ ttl:null });
  }
  static register(gameSession:GameSession, groupPath:string, gsls:GameSummaryList[], filters:Record<string, any>[]) {
    const id = `${gameSession.session.id}:${groupPath}`;
    if (this.cache.has(id))
      console.log(`Warning: Attempt to register '${id}' twice`);

    return this.cache.set(id, () => new GameSessionGameSummaryListGroup(gameSession, groupPath, gsls, filters));
  }
  static unregister(gameSession:GameSession, groupPath:string) {
    const id = `${gameSession.session.id}:${groupPath}`;
    const gsgslp = this.cache.get(id)!;
    for (const gsl of gsgslp.gameSummaryLists)
      gsl.removeAllListeners(undefined, gsgslp);
    this.cache.delete(id);
    return gsgslp;
  }
  static on(...args:Parameters<typeof gameSessionGameSummaryListGroupEmitter.on>) {
    gameSessionGameSummaryListGroupEmitter.on(...args);
  }
  static once(...args:Parameters<typeof gameSessionGameSummaryListGroupEmitter.once>) {
    gameSessionGameSummaryListGroupEmitter.once(...args);
  }
  static off(...args:Parameters<typeof gameSessionGameSummaryListGroupEmitter.off>) {
    gameSessionGameSummaryListGroupEmitter.off(...args);
  }
  static emit(...args:Parameters<typeof gameSessionGameSummaryListGroupEmitter.emit>) {
    gameSessionGameSummaryListGroupEmitter.emit(...args);
  }

  get gameSession() {
    return this.data.gameSession;
  }
  get groupPath() {
    return this.data.groupPath;
  }
  get gameSummaryLists() {
    return this.data.gameSummaryLists;
  }
  get stats() {
    const stats = new Map<string, GameSummaryListStats>();
    for (const [ gsl, gslStats ] of this.data.stats)
      stats.set(gsl.id, gslStats);
    return stats;
  }
  get isRegistered() {
    const id = `${this.data.gameSession.session.id}:${this.data.groupPath}`;
    return GameSessionGameSummaryListGroup.cache.has(id);
  }

  _onChangeGameSummaryList(gameSummaryList:GameSummaryList, event:{ data:{ oldSummary?:GameSummary, gameSummary:GameSummary } }) {
    const wasVisible = this._isGameVisible(event.data.oldSummary);
    const isVisible = this._isGameVisible(event.data.gameSummary);
    const eventType = (
      // e.g. A new waiting game was added, but you are specifically blocked from joining it.
      // e.g. A waiting game was deleted and you were specifically blocked from joining it.
      !wasVisible && !isVisible ? 'none' :
      // e.g. A new waiting game was added and are you not specifically blocked from joining it.
      // e.g. A waiting game changed to active and you were specifically blocked from joining it.
      !wasVisible && isVisible ? 'add' :
      // e.g. A waiting game was deleted and you were not specifically blocked from joining it.
      // e.g. A completed game was pruned
      // e.g. Joined a waiting game and the active game was filtered.
      wasVisible && !isVisible ? 'remove' :
      'change'
    );
    if (eventType === 'none')
      return;

    GameSessionGameSummaryListGroup.emit(`game:${eventType}`, {
      target: this,
      gameSummaryList,
      gameSummary: event.data.gameSummary ?? event.data.oldSummary,
    });

    const stats = this._adjustStats(gameSummaryList, eventType, event.data);
    if (!stats)
      return;

    GameSessionGameSummaryListGroup.emit('stats', {
      target: this,
      gameSummaryList,
      stats,
    });
  }
  /*
   * This method assumes that all pending game creators are loaded in the cache.
   * If they are not in the cache, then it is assumed they haven't blocked the player.
   * This is a safe assumption when viewing your game list, but collections should
   * be sure to eager load all pending game creators.
   */
  _isGameVisible(gameSummary:GameSummary | undefined) {
    if (!gameSummary)
      return false;

    const player = this.data.gameSession.player;
    const filters = this.data.filters;

    /*
     * Determine visibility of the game.
     * Assuming that a game CAN'T change in a way that changes its visibility.
     */
    if (!gameSummary.startedAt && gameSummary.createdBy !== player.id) {
      const creator = Player.cache.get(gameSummary.createdBy);
      if (creator?.hasBlocked(player, false))
        return false;
    }
    if (filters && filters.length && !filters.some(f => test(gameSummary, f)))
      return false;

    return true;
  }
  _getStats(gsl:GameSummaryList) {
    const stats = { waiting:0, active:0 };

    for (const gameSummary of gsl.values()) {
      if (gameSummary.endedAt)
        continue;
      if (!this._isGameVisible(gameSummary))
        continue;

      if (!gameSummary.startedAt)
        stats.waiting++;
      else if (!gameSummary.endedAt)
        stats.active++;
    }

    return stats;
  }
  _adjustStats(gsl:GameSummaryList, eventType:'add' | 'change' | 'remove', { gameSummary, oldSummary }:{ gameSummary:GameSummary, oldSummary?:GameSummary }) {
    const adjustment = { waiting:0, active:0 };
    if (eventType === 'add') {
      if (!gameSummary.startedAt)
        adjustment.waiting++;
      else if (!gameSummary.endedAt)
        adjustment.active++;
    } else if (eventType === 'change') {
      // If not currently started and not previously started, 1 - 1 = 0 (no change)
      // If not currently started and was previuusly started, 1 - 0 = 1 (add, never happens)
      // If currently started and not previously started, 0 - 1 = -1 (sub, game started)
      // If currently started and previously started, 0 + 0 = 0 (no change)
      const waitingChange = (!gameSummary.startedAt ? 1 : 0) + (!oldSummary!.startedAt ? -1 : 0);
      const activeChange = (
        (gameSummary.startedAt && !gameSummary.endedAt ? 1 : 0) +
        (oldSummary!.startedAt && !oldSummary!.endedAt ? -1 : 0)
      );
      adjustment.waiting += waitingChange;
      adjustment.active += activeChange;
    } else {
      if (!oldSummary!.startedAt)
        adjustment.waiting--;
      // Active games are never expected to be removed
      else if (!oldSummary!.endedAt)
        adjustment.active--;
    }

    if (adjustment.waiting === 0 && adjustment.active === 0)
      return false;
    const stats = this.data.stats.get(gsl)!;
    stats.waiting += adjustment.waiting;
    stats.active += adjustment.active;
    return stats;
  }
}