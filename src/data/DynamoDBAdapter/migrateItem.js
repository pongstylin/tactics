const migrationsByKey = new Map();

migrationsByKey.set('game:/', [
  './migrations/20250628_game.js',
]);

export default async function migrateItem(item, props = {}) {
  const itemType = item.PK.split('#')[0];
  const key = `${itemType}:${item.SK}`;
  const migrations = migrationsByKey.get(key);
  if (migrations)
    for (let i = item.V ?? 0; i < migrations.length; i++)
      item = await (await import(migrations[i])).default.call(this, item, props);

  return item;
};

export function getItemVersion(item) {
  const itemType = item.PK.split('#')[0];
  const key = `${itemType}:${item.SK}`;

  return migrationsByKey.get(key)?.length;
};