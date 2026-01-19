import objectHash from 'object-hash';

const unitDataMap = new Map([
  [ 'Knight', {} ],
  [ 'Pyromancer', {} ],
  [ 'Scout', {} ],
  [ 'Cleric', {} ],
  [ 'BarrierWard', { directional:false } ],
  [ 'LightningWard', { directional:false } ],
  [ 'DarkMagicWitch', {} ],
  [ 'Assassin', {} ],
  [ 'Enchantress', {} ],
  [ 'MudGolem', {} ],
  [ 'FrostGolem', {} ],
  [ 'StoneGolem', {} ],
  [ 'DragonTyrant', {} ],
  [ 'BeastRider', {} ],
  [ 'DragonspeakerMage', {} ],
  [ 'ChaosSeed', { directional:false } ],
  [ 'PoisonWisp', {} ],
  [ 'Furgon', {} ],
  [ 'Shrub', { directional:false } ],
  [ 'Trophy', {} ],
  [ 'GolemAmbusher', {} ],
  [ 'Berserker', {} ],
  [ 'ChaosDragon', {} ],
]);

export default async function (itemMap) {
  const item = itemMap.get('/');
  const teamsItem = itemMap.get('/teams/*') ?? (await Promise.all((await this._queryItemParts({ PK:item.PK, SK:'/teams/' })).map(ti => {
    ti.id = parseInt(ti.SK.split('/')[2], 10);
    return this._parseItem(ti);
  }))).sort((a, b) => a.id - b.id).map(({ id, ...item }) => item);

  for (const teamItem of teamsItem.values()) {
    const set = teamItem.D.$data.set;
    if (!set || set.id) continue;

    if (set.units) {
      teamItem.D.$data.setVia = teamItem.D.$data.set.via ?? 'temp';

      const units = cleanUnits(teamItem.D.$data.set.units);
      teamItem.D.$data.set = { id:createTeamSetId({ units }), units };
    } else {
      delete teamItem.D.$data.joinedAt;
      delete teamItem.D.$data.set;
    }
  }

  itemMap.set('/teams/*', teamsItem.map(ti => ({ ...ti, isDirty:true })));
};

function createTeamSetId(set) {
  const setsUnits = [];
  set.units.sort((a,b) => a.assignment[0] - b.assignment[0] || a.assignment[1] - b.assignment[1]);
  setsUnits.push(set.units);

  const setFlippedUnits = JSON.parse(JSON.stringify(set.units));
  for (const unit of setFlippedUnits) {
    unit.assignment[0] = 10 - unit.assignment[0];
    if (unit.direction === 'W')
      unit.direction = 'E';
    else if (unit.direction === 'E')
      unit.direction = 'W';
  }
  setsUnits.push(setFlippedUnits);

  setsUnits.sort((a,b) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i].assignment[0] !== b[i].assignment[0])
        return a[i].assignment[0] - b[i].assignment[0];
      if (a[i].assignment[1] !== b[i].assignment[1])
        return a[i].assignment[1] - b[i].assignment[1];
      if (a[i].direction !== b[i].direction)
        return (a[i].direction ?? 'S').localeCompare(b[i].direction ?? 'S');
      if (a[i].type !== b[i].type)
        return a[i].type.localeCompare(b[i].type);
    }
    return 0;
  });

  return objectHash(setsUnits[0], { encoding:'base64' }).replace(/=+$/, '');
}

function cleanUnits(units) {
  for (const unitState of units) {
    const unitData = unitDataMap.get(unitState.type);

    /*
     * The client may dictate unit type, assignment, and sometimes direction.
     * Other state properties will be computed by the server.
     */
    for (const propName of Object.keys(unitState)) {
      if (propName === 'type' || propName === 'assignment')
        continue;
      else if (propName === 'direction' && unitState[propName] !== 'S' && unitData.directional !== false)
        continue;

      delete unitState[propName];
    }
  }

  return units;
}
