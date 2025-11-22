const migrationsByKey = new Map();

migrationsByKey.set('game:/', [
  './migrations/20250628_game.js',
  './migrations/20251025_game.js',
  './migrations/20251025b_game.js',
  './migrations/20251025c_game.js',
]);

migrationsByKey.set('playerStats:/', [
  './migrations/20250813_playerStats.js',
]);

export default async function migrateItem(item, props = {}) {
  const itemType = item.PK.split('#')[0];
  const key = `${itemType}:${item.SK}`;
  const migrations = migrationsByKey.get(key);
  if (!migrations || migrations.length === item.V)
    return item;
  if (migrations.length < item.V)
    throw new Error(`Item version is ahead of known migrations '${key}': ${item.V} > ${migrations.length}`);

  // This cache allows multiple migrations to not perform redundant DDB operations.
  const cacheItemMap = new Map([
    // The item itself is always dirty since the version has changed
    [item.SK, { isDirty:true, ...item, V:migrations.length }],
  ]);

  for (let i = item.V ?? 0; i < migrations.length; i++)
    await (await import(migrations[i])).default.call(this, cacheItemMap, props);

  const ops = new Map();
  for (let cacheItems of cacheItemMap.values()) {
    if (!Array.isArray(cacheItems))
      cacheItems = [cacheItems];

    for (const { isDirty, ...cacheItem } of cacheItems) {
      if (!isDirty)
        continue;

      const cacheItemKey = `${cacheItem.PK}:${cacheItem.SK}`;
      if (ops.has(cacheItemKey))
        throw new Error(`Duplicate item key while migrating '${key}': ${cacheItemKey}`);

      if (cacheItem.D)
        cacheItem.D = JSON.stringify(cacheItem.D);
      if (cacheItem.PD)
        cacheItem.PD = JSON.stringify(cacheItem.PD);

      ops.set(cacheItemKey, {
        key: 'write:' + cacheItemKey,
        method: (cacheItem.D ?? cacheItem.PD) ? '_putItem' : '_deleteItem',
        args: [ cacheItem ],
        // Push this through as fast as possible since this is a read operation.
        priority: 1,
        skipWait: true,
      });
    }
  }
  await this._pushItemQueue(Array.from(ops.values()));

  return cacheItemMap.get(item.SK);
};

export function getItemVersion(item) {
  const itemType = item.PK.split('#')[0];
  const key = `${itemType}:${item.SK}`;

  return migrationsByKey.get(key)?.length;
};