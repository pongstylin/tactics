import '#plugins/index.js';
import AuthAdapter from '#data/FileAdapter/AuthAdapter.js';
import GameAdapter from '#data/FileAdapter/GameAdapter.js';
import PlayerStats from '#models/PlayerStats.js';

const authAdapter = new AuthAdapter({ hasState:false, readonly:true });
const gameAdapter = new GameAdapter({ hasState:false, readonly:true });
const playerMeta = new Map();

(async () => {
  const gameIds = await gameAdapter.listAllGameIds();

  for (const gameId of gameIds) {
    const game = await gameAdapter._getGame(gameId);

    try {
      if (game.state.endedAt) {
        const lastTurn = game.state.turns.pop();
        await recordGameStats(game);
        game.state.turns.push(lastTurn);
        await recordGameStats(game);
      } else {
        await recordGameStats(game);
      }
    } catch (e) {
      console.error(`Skipping ${game.id}: ${e}`);
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

  for (const playerId of playerMeta.keys()) {
    if (playerMeta.get(playerId) === null)
      continue;

    const player = await authAdapter.getPlayer(playerId);
    const playerStats = await gameAdapter.getPlayerStats(playerId);
    const rankingIds = new Set(
      ...playerMeta.get(playerId).keys(),
      ...playerStats.ratings.keys(),
    );

    for (const rankingId of rankingIds) {
      const oldRating = playerMeta.get(playerId).get(rankingId)?.rating ?? 750;
      const newRating = playerStats.getRating(playerId);

      if (oldRating !== newRating)
        console.log(`${player.name}: ${rankingId}: ${oldRating} => ${newRating}`);
    }
  }
})();

async function recordGameStats(game) {
  const playerIds = Array.from(new Set([ ...game.state.teams.map(t => t.playerId) ]));
  const [ players, playersStats ] = await Promise.all([
    Promise.all(playerIds.map(pId => authAdapter.getPlayer(pId))),
    Promise.all(playerIds.map(pId => gameAdapter.getPlayerStats(pId))),
  ]);
  const playersMap = new Map(players.map(p => [ p.id, p ]));
  const playersStatsMap = new Map(playersStats.map(ps => [ ps.playerId, ps ]));

  for (const playerStats of playersStats) {
    if (playerMeta.has(playerStats.playerId))
      continue;

    if (playersMap.get(playerStats.playerId).isVerified)
      playerMeta.set(playerStats.playerId, playerStats.ratings);
    else
      playerMeta.set(playerStats.playerId, null);

    playerStats.data.stats.clear();
  }

  if (game.state.endedAt) {
    if (PlayerStats.updateRatings(game, playersStatsMap))
      for (const playerStats of playersStats)
        playersMap.get(playerStats.playerId).identity.setRanks(playerStats.playerId, playerStats.ratings);

    for (const playerStats of playersStats)
      playerStats.recordGameEnd(game);
  } else {
    for (const playerStats of playersStats)
      playerStats.recordGameStart(game);
  }
}
