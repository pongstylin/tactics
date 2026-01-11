export default async function (itemMap) {
  const item = itemMap.get('/');
  const turnsItem = itemMap.get('/turns/') ?? (await Promise.all((await this._queryItemParts({ PK:item.PK, SK:'/turns/' })).map(ti => {
    ti.id = parseInt(ti.SK.split('/')[2], 10);
    return this._parseItem(ti);
  }))).sort((a, b) => a.id - b.id);
  // The 2nd condition only happens when game data is missing.
  if (turnsItem.length === 0 || turnsItem.last.id > turnsItem.length - 1)
    return item;

  const turnsItemWithDirty = turnsItem.map(ti => Object.assign({ isDirty:false }, ti));

  for (const turnItem of turnsItemWithDirty) {
    const units = turnItem.D.$data.units.flat();
    const hasTransform = turnItem.D.$data.actions.find(a => a.type === 'transform');
    for (const action of turnItem.D.$data.actions) {
      if (!action.results) continue;

      const results = action.results.slice();
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.changes) {
          const unitData = units.find(u => u.id === result.unit);
          if (unitData && unitData.type === 'Furgon' && result.changes.disposition === 'dead' && hasTransform) {
            result.changes.disposition = 'transform';
            turnItem.isDirty = true;
          }
        }

        if (result.results)
          results.push(...result.results);
      }
    }
  }

  itemMap.set('/turns/', turnsItemWithDirty);
};
