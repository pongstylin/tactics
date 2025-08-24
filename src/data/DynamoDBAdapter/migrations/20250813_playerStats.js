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
    // Ignore invalid data.
    if (stats.completed && stats.ratings && !stats.aliases && !stats.all && !stats.style)
      continue;

    stats.aliases = new Map((stats.aliases ?? []).map(kv => {
      kv[1].lastSeenAt = new Date(kv[1].lastSeenAt);
      return kv;
    }));
    stats.all.startedAt = new Date(stats.all.startedAt);
    stats.style = new Map((stats.style ?? []).map(kv => {
      kv[1].startedAt = new Date(kv[1].startedAt);
      return kv;
    }));

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
