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
      if (!gameSummary.started) continue;

      // To make this run faster, fake the game model.
      const fakeGame = {
        forkOf: gameSummary.isFork,
        state: {
          type: gameSummary.type,
          teams: gameSummary.teams,
          started: gameSummary.started,
          ended: gameSummary.ended,
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
      const ended = game.state.ended;

      game.state.ended = null;
      playerStats.recordGameStart(game);
      game.state.ended = ended;
      playerStats.recordGameEnd(game);
    }
  }

  await gameAdapter.cleanup();
})();
