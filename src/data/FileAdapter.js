'use strict';

import fs from 'fs';

import migrate, { getLatestVersionNumber } from 'data/migrate.js';
import Player from 'models/Player.js';
import Game from 'models/Game.js';
import Room from 'models/Room.js';
import GameSummary from 'models/GameSummary.js';
import ServerError from 'server/Error.js';

const filesDir = 'src/data/files';

export default class {
  constructor() {
    this._locks = new Map();
  }

  async createPlayer(playerData) {
    let player = Player.create(playerData);
    player.version = getLatestVersionNumber('player');

    await this._createFile(`player_${player.id}`, player);
    return player;
  }
  async savePlayer(player) {
    await this._writeFile(`player_${player.id}`, player);
  }
  async getPlayer(playerId) {
    let playerData = await this._readFile(`player_${playerId}`);
    return Player.load(migrate('player', playerData));
  }

  /*
   * This is a bit of a hack.  Ideally, each service may only access its own
   * dedicated data store.  But this method modifies auth data and push data.
   * The right thing to do is have the auth service ask the push service to
   * delete its own data.
   */
  async removePlayerDevice(player, deviceId) {
    player.removeDevice(deviceId);

    await this.savePlayer(player);
    await this.setPushSubscription(player.id, deviceId, null);
  }

  async createGame(gameOptions) {
    let game = Game.create(gameOptions);
    game.version = getLatestVersionNumber('game');

    await this._createFile(`game_${game.id}`, game);
    await this._saveGameSummary(game);

    return game;
  }
  async saveGame(game) {
    await this._writeFile(`game_${game.id}`, game);
    await this._saveGameSummary(game);
  }
  async getGame(gameId) {
    let gameData = await this._readFile(`game_${gameId}`);
    return Game.load(migrate('game', gameData));
  }

  async createRoom(players, options) {
    let room = Room.create(players, options);
    room.version = getLatestVersionNumber('room');

    await this._createFile(`room_${room.id}`, room);

    return room;
  }
  async saveRoom(room) {
    await this._writeFile(`room_${room.id}`, room);
  }
  async getRoom(roomId) {
    let roomData = await this._readFile(`room_${roomId}`);
    return Player.load(migrate('room', roomData));
  }

  async setPushSubscription(playerId, deviceId, subscription) {
    let fileName = `player_${playerId}_push`;
    let pushData = await this._readFile(fileName, {
      subscriptions: [],
    });
    pushData.subscriptions = new Map(pushData.subscriptions);
    if (subscription)
      pushData.subscriptions.set(deviceId, subscription);
    else
      pushData.subscriptions.delete(deviceId);
    pushData.subscriptions = [...pushData.subscriptions];

    await this._writeFile(fileName, pushData);
  }
  async getAllPushSubscriptions(playerId) {
    let fileName = `player_${playerId}_push`;
    let pushData = await this._readFile(fileName, {
      subscriptions: [],
    });

    return new Map(pushData.subscriptions);
  }

  /*
   * It doesn't matter what the query syntax is, so long as the client and the
   * data adapter can understand it.  As a rule, the server should not be in the
   * business of constructing queries.  If the server needs a filtered data set,
   * then a specialized data adapter method should be created to provide it.
   *
   * With all that said, I'm working with a JSON representation of a query using
   * the following structure that I expect would be intuitive and readable.
   *
   * Query structure:
   *   {
   *     "filters": filter,         // nested list of filters
   *     "page": #pageNumber#,      // base 1
   *     "limit": #ResultsPerPage#, // default 10
   *     "sort": [sort],            // list of sort criteria
   *   }
   *
   * Filter structure:
   *   A filter is either an array or an object.  The brackets and braces are
   *   similar to parenthetical groups of groups or conditions that are joined
   *   using a boolean 'OR' or 'AND' operator respectively.
   *
   *   JSON: { "isEnded":true, "teams[].playerId":[123,456] }
   *   SQL : ( isEnded = true AND teams[].playerId IN (123,456) )
   *
   *   JSON: [{ "started":null }, { "teams[].playerId":[123,456] }]
   *   SQL : (( started IS null ) OR ( teams[].playerId IN (123,456)))"
   *
   *   The "NOT" operator can be applied to a group.  These expressions are the
   *   negated versions of the above.  Unlike most object filters, the "!"
   *   property is not treated as a field name.
   *
   *   JSON: { "!": { "isEnded":true }, "teams[].playerId":[123,456] } }
   *   SQL : NOT ( isEnded = true ) AND teams[].playerId IN (123,456) )
   *
   *   JSON: { "!": [{ "started":null }, { "teams[].playerId":[123,456] }] }
   *   SQL : NOT (( started IS null ) OR ( teams[].playerId IN (123,456)))"
   *
   *   Besides the implied "=" and "IN" operators demonstrated above, other
   *   condition operators can also be used if the value is an object.
   *   I haven't implemented special condition operators, but here are a few.
   *
   *   JSON: { "nameOfStringField":   { "match":"^regex"               } }
   *   JSON: { "nameOfNumberField:    { "between":[5, 7]               } }
   *   JSON: { "nameOfDateField":     { ">":"2019-07-08T00:00:00.000Z" } }
   *   JSON: { "nameOfOptionalField": { "exists":true                  } }
   *   JSON: { "nameOfArrayField":    { "isDeeply":[1, 2, 3]           } }
   *
   *   Also, you might have noticed the use of '[]' after 'teams'.  This is to
   *   recognize that 'teams' is an array, so the filter is applied to each
   *   element of the array to test if any of them is a hit.  To operate upon a
   *   subset of elements, use this syntax:
   *
   *   teams[0]:null            // The first team must be null
   *   teams[-1]:null           // The last team must be null
   *   teams[0, 1]:null         // Either the first or second team is null.
   *   teams[0-1]:null          // Same behavior as the previous example.
   *
   * Sort structure:
   *   Each element in the sort list is either a string or object.  If a string,
   *   then it is the field name.  Nested fields use dot separators.
   *   {
   *     "field": <field>,
   *     "order": "asc" | "desc",
   *   }
   *
   * Return structure:
   *   {
   *     "page": #pageNumber#,
   *     "limit": #ResultsPerPage#,
   *     "count": #TotalResults#,
   *     "hits": [...],  // list of game summaries
   *   }
   */
  async searchPlayerGames(playerId, query) {
    let games = await this._getPlayerGamesSummary(playerId);
    let data = [...games.values()];

    return this._search(data, query);
  }
  async searchOpenGames(query) {
    let games = await this._getOpenGamesSummary();
    let data = [...games.values()];

    return this._search(data, query);
  }
  _search(data, query) {
    query = Object.assign({
      page: 1,
      limit: 10,
    }, query);

    if (query.limit > 50)
      throw new ServerError(400, 'Maximum limit is 50');

    let offset = (query.page - 1) * query.limit;
    let hits = data
      .filter(this._compileFilter(query.filter))
      .sort(this._compileSort(query.sort));

    return Promise.resolve({
      page: query.page,
      limit: query.limit,
      count: hits.length,
      hits: hits.slice(offset, offset+query.limit),
    });
  }

  /*
   * Not intended for use by applications.
   */
  listAllGameIds() {
    return new Promise((resolve, reject) => {
      let gameIds = [];
      let regex = /^game_(.+)\.json$/;

      fs.readdir(filesDir, (err, fileNames) => {
        for (let i=0; i<fileNames.length; i++) {
          let match = regex.exec(fileNames[i]);
          if (!match) continue;

          gameIds.push(match[1]);
        }

        resolve(gameIds);
      });
    });
  }

  async _getOpenGamesSummary() {
    return new Map(await this._readFile(`open_games`, []));
  }
  /*
   * Get all of the games in which the player is participating.
   */
  async _getPlayerGamesSummary(playerId) {
    return new Map(await this._readFile(`player_${playerId}_games`, []));
  }
  /*
   * Update the game summary for all participating players.
   */
  async _saveGameSummary(game) {
    let summary = new GameSummary(game);

    // Get a unique list of player IDs from the teams.
    let playerIds = new Set(
      game.state.teams.filter(t => t && !!t.playerId).map(t => t.playerId)
    );

    // Convert the player IDs to a list of promises.
    let promises = [...playerIds].map(playerId =>
      this._getPlayerGamesSummary(playerId).then(summaryList => {
        summaryList.set(game.id, summary);

        return this._writeFile(`player_${playerId}_games`, [...summaryList]);
      })
    );

    if (game.isPublic)
      promises.push(
        this._getOpenGamesSummary().then(summaryList => {
          let isDirty = false;

          if (game.state.started) {
            if (summaryList.has(game.id)) {
              summaryList.delete(game.id, summary);
              isDirty = true;
            }
          }
          else {
            summaryList.set(game.id, summary);
            isDirty = true;
          }

          if (isDirty)
            return this._writeFile(`open_games`, [...summaryList])
        })
      )

    await Promise.all(promises);
  }

  /*
   * Not a true lock.  In a multi-process context, this would suffer.
   *
   * Locks ensure all started write operations are done before reading/writing.
   */
  async _lock(name, type, transaction) {
    let lock = this._locks.get(name);

    if (type === 'read')
      return (lock ? lock.current : Promise.resolve()).then(transaction);

    if (lock) {
      lock.count++;
      lock.current = lock.current.then(transaction);
    }
    else
      this._locks.set(name, lock = {
        count: 1,
        current: Promise.resolve().then(transaction),
      });

    // Once all write locks on this file are released, remove from memory.
    lock.current.finally(() => {
      if (--lock.count === 0)
        this._locks.delete(name);
    });

    return lock.current;
  }
  async _createFile(name, data) {
    let fqName = `${filesDir}/${name}.json`;

    return this._lock(name, 'write', () =>
      new Promise((resolve, reject) => {
        fs.writeFile(fqName, JSON.stringify(data), { flag:'wx' }, error => {
          if (error) {
            console.log('createFile', error);
            reject(new ServerError(500, 'Create failed'));
          }
          else
            resolve();
        });
      })
    );
  }
  async _writeFile(name, data) {
    let fqNameTemp = `${filesDir}/.${name}.json`;
    let fqName = `${filesDir}/${name}.json`;

    return this._lock(name, 'write', () =>
      new Promise((resolve, reject) => {
        fs.writeFile(fqNameTemp, JSON.stringify(data), error => {
          if (error) {
            console.log('writeFile', error);
            reject(new ServerError(500, 'Save failed'));
          }
          else
            resolve();
        });
      }).then(() => new Promise((resolve, reject) => {
        fs.rename(fqNameTemp, fqName, error => {
          if (error) {
            console.log('rename', error);
            reject(new ServerError(500, 'Save failed'));
          }
          else
            resolve();
        });
      }))
    );
  }
  async _readFile(name, initialValue) {
    let fqName = `${filesDir}/${name}.json`;

    return this._lock(name, 'read', () =>
      new Promise((resolve, reject) => {
        fs.readFile(fqName, 'utf8', (error, data) => {
          if (error)
            reject(error);
          else
            resolve(JSON.parse(data));
        });
      }).catch(error => {
        if (error.code === 'ENOENT')
          if (initialValue === undefined)
            error = new ServerError(404, 'Not found');
          else
            return initialValue;

        throw error;
      })
    );
  }

  _compileFilter(filter) {
    if (!filter)
      return item => true;

    return item => this._matchItem(item, filter);
  }
  _matchItem(item, filter) {
    if (Array.isArray(filter))
      // OR logic: return true for the first sub-filter that returns true.
      // Otherwise, return false.
      return filter.findIndex(f => this._matchItem(item, f)) > -1;
    else if (filter !== null && typeof filter === 'object')
      // AND logic: return false for the first sub-filter that returns false.
      // Otherwise, return true.
      return Object.keys(filter)
        .findIndex(f => !this._matchItemByCondition(item, f, filter[f])) === -1;
    else
      throw new Error('Malformed filter');
  }
  _matchItemByCondition(item, path, condition) {
    if (path === '!')
      return !this._matchItem(item, condition);

    let value = item;

    if (path.length) {
      let fields = path.split('.');
      while (fields.length) {
        if (value === null) break;

        let field = fields.shift();
        let slice = field.match(/\[.*?\]$/);
        if (slice) {
          field = field.slice(0, slice.index);
          slice = slice[0].slice(1, -1);
        }

        if (field in value) {
          value = value[field];

          if (slice !== null) {
            if (!Array.isArray(value))
              throw new Error('Range applied to non-array value');

            let elements = [];

            if (slice.trim().length === 0)
              elements = value;
            else {
              let indices = slice.split(/\s*,\s*/);
              while (indices.length) {
                let index = indices.shift();
                let range = index.split(/\s*-\s*/);

                if (range.length === 2)
                  elements.push(...value.slice(...range));
                else if (range.length === 1)
                  elements.push(value[range]);
                else
                  throw new Error('Invalid range in filter array slice');
              }
            }

            let subPath = fields.join('.');
            return elements.findIndex(
              el => this._matchItemByCondition(el, subPath, condition)
            ) > -1;
          }
        }
        else
          value = null;
      }
    }

    if (Array.isArray(condition) && typeof value === 'object')
      throw new Error('Array conditions can only be used on primitive values');
    else if (condition !== null && typeof condition === 'object')
      throw new Error('Complex conditions are not implemented');

    if (Array.isArray(value)) {
      if (!slice)
        throw new Error('Filtering by array field is not implemented');
    }
    else if (value !== null && typeof value === 'object') {
      return false;
    }
    else {
      if (Array.isArray(condition))
        return condition.includes(value);
      else
        return value === condition;
    }
  }

  _compileSort(sort) {
    if (!sort)
      return (a, b) => 0;

    if (typeof sort === 'string')
      return (a, b) => this._sortItemsByField(a, b, sort);
    else
      throw new ServerError(501, 'Only a string sort type is supported');
  }
  _sortItemsByField(a, b, str) {
    if (a[str] < b[str]) return -1;
    if (b[str] < a[str]) return 1;
    return 0;
  }
};
