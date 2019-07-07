'use strict';

import fs from 'fs';
import Player from 'models/Player.js';
import Game from 'models/Game.js';
import ServerError from 'server/Error.js';

const filesDir = 'src/data/files';

export default class {
  createPlayer(playerData) {
    let player = Player.create(playerData);
    this._writeFile(`player_${player.id}`, player);
    return player;
  }
  savePlayer(player) {
    this._writeFile(`player_${player.id}`, player);
  }
  getPlayer(playerId) {
    let playerData = this._readFile(`player_${playerId}`);
    return Player.load(playerData);
  }

  createGame(stateData) {
    let game = Game.create(stateData);
    this._writeFile(`game_${game.id}`, game);
    return game;
  }
  saveGame(game) {
    this._writeFile(`game_${game.id}`, game);
  }
  getGame(gameId) {
    let gameData = this._readFile(`game_${gameId}`);
    return Game.load(gameData);
  }

  _writeFile(name, data) {
    try {
      // Avoid corrupting files when crashing by writing to a temporary file.
      fs.writeFileSync(`${filesDir}/.${name}.json`, JSON.stringify(data));
      fs.renameSync(`${filesDir}/.${name}.json`, `${filesDir}/${name}.json`);
    }
    catch (error) {
      if (error.code === 'ENOENT')
        error = new ServerError(404, 'Not found');

      throw error;
    }
  }
  _readFile(name) {
    try {
      let json = fs.readFileSync(`${filesDir}/${name}.json`, 'utf8');
      return JSON.parse(json);
    }
    catch (error) {
      if (error.code === 'ENOENT')
        error = new ServerError(404, 'Not found');

      throw error;
    }
  }
};
