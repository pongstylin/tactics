export default async function (itemMap) {
  const item = itemMap.get('/');
  const turnsItem = itemMap.get('/turns/') ?? (await Promise.all((await this._queryItemParts({ PK:item.PK, SK:'/turns/' })).map(ti => {
    ti.id = parseInt(ti.SK.split('/')[2], 10);
    return this._parseItem(ti);
  }))).sort((a, b) => a.id - b.id);

  delete item.D.$transform;
  item.D.$type = 'Game';

  const stateData = item.D.$data.state;
  stateData.numTeams = stateData.teams;
  delete stateData.teams;

  // The 2nd condition only happens when game data is missing.
  if (turnsItem.length === 0 || turnsItem.last.id > turnsItem.length - 1)
    return item;

  const teamsItem = itemMap.get('/teams/') ?? (await Promise.all((await this._queryItemParts({ PK:item.PK, SK:'/teams/' })).map(ti => {
    ti.id = parseInt(ti.SK.split('/')[2], 10);
    return this._parseItem(ti);
  }))).sort((a, b) => a.id - b.id);

  const initialTurnId = _getInitialTurnId(teamsItem);

  stateData.numTurns = turnsItem.length;
  stateData.startedAt = turnsItem[0].D.$data.startedAt;

  for (const turnItem of turnsItem) {
    delete turnItem.D.$transform;
    turnItem.D.$type = 'Turn';

    if (turnItem.D.$data.isLocked) {
      stateData.lockedTurnId = turnItem.id;
      delete turnItem.D.$data.isLocked;
    }

    _applyTurnDrawCounts(
      turnItem,
      turnsItem[turnItem.id - 1] ?? null,
      initialTurnId,
    );
  }

  const lastAction = turnsItem.last.D.$data.actions?.last ?? null;
  if (lastAction?.type === 'endGame') {
    stateData.endedAt = lastAction.createdAt;
    stateData.winnerId = lastAction.winnerId;
  }

  itemMap.set('/teams/', teamsItem);
  itemMap.set('/turns/', turnsItem.map(ti => ({ ...ti, isDirty:true })));
};

function _getInitialTurnId(teamItems) {
  return Math.min(...teamItems.map(ti => {
    const waitTurns = Math.min(...ti.D.$data.set.units.map(u => u.mRecovery ?? 0));
    return ti.id + teamItems.length * waitTurns;
  }));
}

function _applyTurnDrawCounts(currentTurn, previousTurn, initialTurnId) {
  if (currentTurn === null)
    return;
  if (currentTurn.id < initialTurnId)
    return;

  // This should never happen, but just in case.
  if (previousTurn === null)
    throw new Error('Previous turn must be loaded to apply draw counts');

  const drawCounts = (previousTurn.D.$data.drawCounts ?? {
    passedTurnCount: -1,
    attackTurnCount: -1,
  }).clone();
  drawCounts.passedTurnCount++;
  drawCounts.attackTurnCount++;

  // Reset the counts when particular actions take place...
  if (previousTurn.D.$data.actions.length > 1) {
    drawCounts.passedTurnCount = 0;

    for (const action of previousTurn.D.$data.actions) {
      if (!action.type.startsWith('attack')) continue;

      let attackerTeamId;
      for (const [ teamId, teamUnits ] of previousTurn.D.$data.units.entries()) {
        if (teamUnits.find(tu => tu.id === action.unit)) {
          attackerTeamId = teamId;
          break;
        }
      }

      for (const result of action.results) {
        // This check ignores summoned units, e.g. shrubs
        if (typeof result.unit !== 'number') continue;
        // Ignore immune attacks
        if (result.miss === 'immune') continue;

        let defenderTeamId;
        for (const [ teamId, teamUnits ] of previousTurn.D.$data.units.entries()) {
          if (teamUnits.find(tu => tu.id === result.unit)) {
            defenderTeamId = teamId;
            break;
          }
        }

        if (defenderTeamId !== attackerTeamId) {
          drawCounts.attackTurnCount = 0;
          break;
        }
      }
    }
  }

  currentTurn.D.$data.drawCounts = drawCounts;
}