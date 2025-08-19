export default async function (itemMap) {
  const item = itemMap.get('/');
  const data = item.D.$data;
  const statsMap = new Map(data.stats);
  delete data.stats;

  const opponents = [];
  for (const [playerId, stats] of statsMap) {
    if (playerId === data.playerId) {
      data.numCompleted = stats.completed[0];
      data.numAbandoned = stats.completed[1];
      data.ratings = stats.ratings;
      continue;
    }

    opponents.push({
      PK: `playerStats#${data.playerId}`,
      SK: `/vs/${playerId}`,
      D: stats,
      TTL: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    });
  }

  item.isDirty = true;
  itemMap.set('/vs/*', opponents.map(o => ({ ...o, isDirty:true })));
};
