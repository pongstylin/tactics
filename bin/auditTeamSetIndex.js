import '#plugins/index.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import TeamSet from '#models/TeamSet.js';
import Timeout from '#server/Timeout.js';

const ticker = setInterval(Timeout.tick, 5000);
const dryRun = false;
const gameAdapter = await new GameAdapter({ hasState:false, readonly:dryRun }).bootstrap();
const stats = { total:0, deleted:0 };

for (const gameType of gameAdapter.getGameTypesById().values()) {
  for (const metricName of [ 'rating', 'gameCount', 'playerCount' ]) {
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

        if (oldTeamSetId === newTeamSetId) continue;

        gameAdapter.deleteItem({
          PK: `teamSetIndex#${gameType.id}/${metricName}`,
          SK: item.SK,
        });
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
