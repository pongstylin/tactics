import 'plugins/array.js';
import 'plugins/set.js';
import 'plugins/map.js';
import 'plugins/string.js';
import AuthAdapter from 'data/FileAdapter/AuthAdapter.js';
import GameAdapter from 'data/FileAdapter/GameAdapter.js';

const authAdapter = new AuthAdapter();
const gameAdapter = new GameAdapter();

(async () => {
  const playerIds = await authAdapter.listAllPlayerIds();

  for (const playerId of playerIds) {
    const playerStats = await gameAdapter._getPlayerStats(playerId);
    playerStats.data.clear();

    const activeGames = await gameAdapter._getPlayerActiveGames(playerId);
    for (const gameSummary of activeGames.values()) {
      if (gameSummary.isFork) continue;
      if (!gameSummary.startedAt) continue;

      // To make this run faster, fake the game model.
      const fakeGame = {
        forkOf: gameSummary.isFork,
        state: {
          type: gameSummary.type,
          teams: gameSummary.teams,
          startedAt: gameSummary.startedAt,
          endedAt: gameSummary.endedAt,
        },
      };

      playerStats.recordGameStart(fakeGame);
    }

    const completedGames = await gameAdapter._getPlayerCompletedGames(playerStats.playerId);
    for (const gameSummary of completedGames.values()) {
      if (gameSummary.isFork) continue;

      const myTeams = gameSummary.teams.find(t => t.playerId === playerStats.playerId);
      // No stats for practice games.
      if (myTeams.length === gameSummary.teams.length)
        continue;

      const game = await gameAdapter._getGame(gameSummary.id);
      const endedAt = game.state.endedAt;

      game.state.endedAt = null;
      playerStats.recordGameStart(game);
      game.state.endedAt = endedAt;
      playerStats.recordGameEnd(game);
    }

    // Reset WLD stats to zero, preserving global stats and aliases
    for (const [ thisPlayerId, stats ] of playerStats.data.entries()) {
      if (thisPlayerId === playerId) continue;

      stats.all.win = [0,0];
      stats.all.lose = [0,0];
      stats.all.draw = [0,0];

      for (const [ gameTypeId, styleStats ] of stats.style) {
        styleStats.win = [0,0];
        styleStats.lose = [0,0];
        styleStats.draw = [0,0];
      }
    }
  }

  await gameAdapter.cleanup();
})();
