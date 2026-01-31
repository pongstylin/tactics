import '#plugins/index.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import TeamSet from '#models/TeamSet.js';
import Timeout from '#server/Timeout.js';

const ticker = setInterval(Timeout.tick, 5000);
const dryRun = false;
const gameAdapter = await new GameAdapter({ hasState:false, readonly:dryRun }).bootstrap();

for (const gameType of gameAdapter.getGameTypesById().values()) {
  for (const metricName of [ 'rating', 'gameCount', 'playerCount' ]) {
    const stats = { total:0, deleted:0 };
    const query = {
      attributes: [ 'SK', 'PD' ],
      filters: {
        PK: `teamSetIndex#${gameType.id}/${metricName}`,
        LSK0: { beginsWith:`/` },
      },
      order: 'DESC',
      cursor: undefined,
      limit: true,
    };

    while (true) {
      const result = await gameAdapter.query(query, true);
      query.cursor = result.cursor;
      stats.total += result.items.length;

      for (const item of result.items) {
        const oldTeamSetId = item.SK.slice(8, 35);
        const newTeamSetId = TeamSet.createId(item.PD);
        const isValid = (() => {
          try {
            gameType.validateSet(item.PD);
            return true;
          } catch (e) {
            return false;
          }
        })();

        if (oldTeamSetId === newTeamSetId && isValid) continue;

        gameAdapter.deleteItem({
          PK: `teamSetIndex#${gameType.id}/${metricName}`,
          SK: item.SK,
        });
        // Avoid deleting the same items multiple times
        if (metricName === 'rating') {
          gameAdapter.deleteItem({
            PK: `teamSet#${oldTeamSetId}`,
            SK: `/stats/${gameType.id}`,
          });
          gameAdapter.deleteItems({ filters:{
            PK: `teamSet#${oldTeamSetId}`,
            SK: { beginsWith:`/stats/${gameType.id}/` },
          } });
        }
        stats.deleted++;
      }
      await gameAdapter.flush();

      if (!query.cursor) break;
    }

    console.log(gameType.id, metricName, stats);
  }
}

await gameAdapter.cleanup();
clearInterval(ticker);
console.log('Audit complete');
