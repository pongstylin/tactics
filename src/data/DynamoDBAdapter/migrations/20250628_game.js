export default async function (item) {
  const turnsItem = (await Promise.all((await this._queryItemParts({ PK:item.PK, SK:'/turns/' })).map(async ti => {
    ti.id = parseInt(ti.SK.split('/')[2], 10);
    ti.D = await this._parseItem(ti);
    return ti;
  }))).sort((a, b) => a.id - b.id);
  // The 2nd condition only happens when game data is missing.
  if (turnsItem.length === 0 || turnsItem.last.id > turnsItem.length - 1)
    return item;

  const teamsItem = (await Promise.all((await this._queryItemParts({ PK:item.PK, SK:'/teams/' })).map(async ti => {
    ti.id = parseInt(ti.SK.split('/')[2], 10);
    ti.D = await this._parseItem(ti);
    return ti;
  }))).sort((a, b) => a.id - b.id);

  const initialTurnId = _getInitialTurnId(teamsItem);
  const lastAction = turnsItem.last.D.$data.actions?.last ?? null;
  const stateData = item.D.$data.state;

  stateData.startedAt = turnsItem[0].D.$data.startedAt;
  stateData.currentTurnId = turnsItem.last.id;

  for (const turnItem of turnsItem) {
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

  if (lastAction?.type === 'endGame') {
    stateData.endedAt = lastAction.createdAt;
    stateData.winnerId = lastAction.winnerId;
  }

  return item;
};

function _getInitialTurnId(teamItems) {
  return Math.min(...teamItems.map(ti => {
    const waitTurns = Math.min(...ti.D.$data.$data.set.units.map(u => u.mRecovery ?? 0));
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
  if (previousTurn.actions.length > 1) {
    drawCounts.passedTurnCount = 0;

    for (const action of previousTurn.actions) {
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