/*
 * The purpose of this module is to migrate the JSON representation of player
 * and game objects to the latest version.
 */
import unitDataMap from '#tactics/unitData.js';
import GameType from '#tactics/GameType.js';
import timeLimit from '#config/timeLimit.js';

const migrationMap = new Map();

migrationMap.set('player', [
  /*
   * Addresses are now nested under agents instead of siblings.  Agent/address
   * associations cannot be perfectly restored, but close enough.
   *
   * Devices are now stored as an array, but still loaded as a Map.
   *
   * Ensure all devices have a name.  When blank, use null.
   */
  data => {
    for (let i = 0; i < data.devices.length; i++) {
      let device = data.devices[i][1];

      // Apply this change if-needed since it was made before migrations
      // were a thing.
      if (device.addresses) {
        let deviceAddresses = device.addresses;
        delete device.addresses;

        device.name = null;
        device.agents.forEach(([agent, agentLastSeenAt], i) => {
          let agentAddresses = [];

          deviceAddresses.forEach(([address, addressLastSeenAt]) => {
            agentAddresses.push([
              address,
              agentLastSeenAt < addressLastSeenAt
                ? agentLastSeenAt
                : addressLastSeenAt,
            ]);
          });

          device.agents[i][1] = agentAddresses;
        });
      }

      data.devices[i] = device;
    }

    return data;
  },
  data => {
    data.createdAt = data.created;
    delete data.created;

    data.acl = new Map();
    data.reverseACL = new Map();

    /*
     * Approximate the checkout date based on the most recent checkin date.
     */
    data.checkoutAt = data.createdAt;
    for (let device of data.devices) {
      for (let [agent, addresses] of device.agents) {
        for (let [address, checkinAt] of addresses) {
          if (checkinAt > data.checkoutAt)
            data.checkoutAt = checkinAt;
        }
      }
    }

    return data;
  },
  data => {
    delete data.version;

    return { type:'Player', data };
  },
  json => {
    return {
      $type: json.type,
      $data: json.data,
    };
  },
  json => {
    const data = json.$data;

    if ('anonAccounts' in data.acl) {
      data.acl.guestAccounts = data.acl.anonAccounts;
      delete data.acl.anonAccounts;
    }

    return json;
  },
]);

migrationMap.set('identity', [
  json => {
    const data = json.$data;

    if (data.ranks)
      data.ranks.ratings = data.ranks.ratings.map(([ rId, r ]) => ({
        rankingId: rId,
        rating: r.rating,
        gameCount: r.gameCount,
      }));

    return json;
  },
  json => {
    const data = json.$data;

    if (data.ranks)
      data.ranks.ratings = data.ranks.ratings.filter(r => r.rankingId !== 'FORTE');

    return json;
  },
  json => {
    const data = json.$data;

    if (data.ranks)
      data.ranks.ratings.sort((a,b) => b.rating - a.rating);

    return json;
  },
]);

migrationMap.set('game', [
  /*
   * Added turnTimeLimit to game state.  When blank, should be null.
   *
   * Added turnStarted to game state.  The value is bootstrapped to when the
   * previous turn ended or game start for the first turn.  It would only differ
   * from these when a player uses 'undo' to revert to the previous turn.
   */
  data => {
    if (data.state.turnTimeLimit === undefined)
      data.state.turnTimeLimit = null;

    if (!data.state.turnStarted)
      if (data.state.turns.length)
        data.state.turnStarted = data.state.turns.last.actions.last.created;
      else
        data.state.turnStarted = data.state.started;

    return data;
  },
  /*
   * Renamed 'breakFocus' action type to 'break'.
   */
  data => {
    data.state.turns.forEach(turnData => {
      turnData.actions.forEach(action => {
        if (action.type === 'breakFocus')
          action.type = 'break';
      });
    });

    return data;
  },
  /*
   * Changed a couple of team fields.
   */
  data => {
    data.state.teams.forEach(team => {
      if (!team) return;

      team.createdAt = team.joined;
      delete team.joined;

      team.slot = team.originalId;
      delete team.originalId;
    });

    return data;
  },
  data => {
    data.state.randomHitChance = true;

    data.state.teams.forEach(team => {
      if (!team) return;

      team.useRandom = true;
    });

    return data;
  },
  /*
   * Place a lower limit on mHealth
   */
  data => {
    let migrateResults = (units, results) => {
      if (!results) return;

      results.forEach(result => {
        if (result.changes) {
          let newMHealth = result.changes.mHealth;
          if (newMHealth !== undefined) {
            let unit = units.find(u => u.id === result.unit);
            if (unit) {
              let oldMHealth = unit.mHealth || 0;
              let unitData = unitDataMap.get(unit.type);

              if (newMHealth < oldMHealth)
                result.damage = oldMHealth - newMHealth;
              else if (newMHealth > oldMHealth)
                result.damage = -12; // assume 12 heal power (cleric)
              else
                result.damage = 0;

              if (newMHealth < -unitData.health)
                result.changes.mHealth = -unitData.health;
            }
          }
        }

        migrateResults(units, result.results);
      });
    };

    migrateResults(data.state.units.flat(), data.state.actions);

    data.state.turns.forEach(turn => {
      migrateResults(turn.units.flat(), turn.actions);
    });

    return data;
  },
  /*
   * A null set has changed in meaning from "not provided/joined yet" to "no custom set".
   * An undefined set used to be impossible, but now means "not provided/joined yet".
   * Convert array sets to object sets (mostly useful for games not started yet)
   * Add unit state to team sets (ditto)
   * Add team joinedAt dates.
   */
  data => {
    let gameType = new GameType(data.state.type, {});
    let teams = [ ...data.state.teams ];
    if (data.state.randomFirstTurn)
      // Teams joined in slot order
      teams.sort((a,b) => {
        if (!a?.set && !b?.set)
          return 0;
        if (!a?.set)
          return 1;
        if (!b?.set)
          return -1;
        return a.slot - b.slot;
      });
    else
      // There is no way to tell which team joined first except by creation date.
      // Unfortunately, for practice games, the creation date could be in the wrong order.
      // The joinedAt date now makes it possible to always know who jumped who.
      teams.sort((a,b) => {
        if (!a?.set && !b?.set)
          return 0;
        if (!a?.set)
          return 1;
        if (!b?.set)
          return -1;
        return a.createdAt - b.createdAt;
      });

    for (let team of teams) {
      if (team === null) continue;

      // Not having a set used to indicate "not provided/joined yet".
      if (team.set === null) {
        team.set = undefined;
        continue;
      }
      if (Array.isArray(team.set))
        team.set = gameType.applySetUnitState({ units:team.set });

      if (team === teams[teams.length - 1])
        team.joinedAt = data.state.started;
      else
        team.joinedAt = team.createdAt;
    }

    return data;
  },
  data => {
    // Approximate team checkoutAt dates.
    let currentTeamId = data.state.turns.length & data.state.teams.length;

    for (let i = 0; i < data.state.teams.length; i++) {
      const team = data.state.teams[i];
      if (team === null) continue;
      team.checkoutAt = null;

      if (data.state.ended)
        team.checkoutAt = data.state.ended;
      else if (data.state.actions.length && currentTeamId === i)
        team.checkoutAt = data.state.actions.last.created;
      else
        SKIP:for (let j = data.state.turns.length - 1; j > -1; j--) {
          let actions = data.state.turns[j].actions;
          for (let k = actions.length - 1; k > -1; k--) {
            let action = actions[k];
            if (action.forced) continue;

            team.checkoutAt = action.created;
            break SKIP;
          }
        }
    }

    return data;
  },
  data => {
    data.createdAt = data.created;
    delete data.created;

    data.state.startedAt = data.state.started;
    delete data.state.started;

    data.state.turnStartedAt = data.state.turnStarted;
    delete data.state.turnStarted;

    data.state.endedAt = data.state.ended;
    delete data.state.ended;

    if (data.state.endedAt && data.state.winnerId === null)
      data.state.winnerId = 'draw';

    for (const turn of data.state.turns) {
      turn.startedAt = turn.started;
      delete turn.started;

      for (const action of turn.actions) {
        action.createdAt = action.created;
        delete action.created;
      }
    }

    for (const action of data.state.actions) {
      action.createdAt = action.created;
    }

    if (data.undoRequest) {
      const teams = data.state.teams;
      const createdBy = teams[data.undoRequest.teamId].playerId;
      const status = data.undoRequest.status;

      data.playerRequest = {
        createdAt: data.undoRequest.createdAt,
        createdBy,
        status,
        type: 'undo',
        accepted: data.undoRequest.accepts.map(tId => teams[tId].playerId),
        rejected: status === 'rejected' ? [[ `${createdBy}:undo`, data.undoRequest.rejectedBy ]] : [],
        teamId: data.undoRequest.teamId,
      };
      delete data.undoRequest;
    }

    return data;
  },
  data => {
    delete data.version;
    if (data.undoRequest === null) {
      if (data.playerRequest === undefined)
        data.playerRequest = null;
      delete data.undoRequest;
    }

    return { type:'Game', data };
  },
  json => {
    const isPublic = json.data.isPublic;
    delete json.data.isPublic;
    if (isPublic)
      json.data.collection = 'public';

    if (json.data.playerRequest === undefined)
      json.data.playerRequest = null;

    return json;
  },
  json => {
    return {
      $type: json.type,
      $data: json.data,
    };
  },
  json => {
    const state = json.$data.state;

    for (let i = 0; i < state.turns.length; i++) {
      const actions = state.turns[i].actions;
      if (actions[0].unit)
        actions.unshift({ type:'select', unit:actions[0].unit });
    }

    if (state.actions[0]?.unit)
      state.actions.unshift({ type:'select', unit:state.actions[0].unit });

    return json;
  },
  json => {
    const state = json.$data.state;

    for (let i = 0; i < state.turns.length; i++) {
      const actions = state.turns[i].actions;
      if (actions[0].type === 'select' && !actions[0].createdAt && actions[1].unit)
        Object.assign(actions[0], {
          teamId: actions[1].teamId,
          createdAt: actions[1].createdAt,
        });
    }

    const actions = state.actions;
    if (actions[0]?.type === 'select' && !actions[0].createdAt && actions[1].unit)
      Object.assign(actions[0], {
        unit: actions[1].unit,
        teamId: actions[1].teamId,
        createdAt: actions[1].createdAt,
      });

    return json;
  },
  json => {
    const state = json.$data.state;

    for (let i = 0; i < state.turns.length; i++) {
      const actions = state.turns[i].actions;
      if (actions[0].type !== 'select' && actions[0].unit !== undefined)
        actions.unshift({
          type: 'select',
          unit: actions[0].unit,
          teamId: actions[0].teamId,
          createdAt: actions[0].createdAt,
        });
    }

    const actions = state.actions;
    if (actions.length && actions[0].type === 'select' && actions[0].unit !== undefined)
      actions.unshift({
        type: 'select',
        unit: actions[0].unit,
        teamId: actions[0].teamId,
        createdAt: actions[0].createdAt,
      });

    return json;
  },
  json => {
    const state = json.$data.state;
    const playerIds = new Set(state.teams.map(t => t?.playerId));
    if (state.rated === undefined)
      state.rated = !json.$data.forkOf && playerIds.size > 1;

    return json;
  },
  json => {
    const game = json.$data;
    const state = game.state;

    if (state.turnTimeLimit) {
      const timeLimitNameMap = new Map([
        [ 604800, 'week' ],
        [ 86400, 'day' ],
        [ 43200, '12hour' ],
        [ 120, 'relaxed' ],
        [ 30, 'blitz' ],
      ]);

      game.timeLimitName = timeLimitNameMap.get(state.turnTimeLimit);
      if (game.timeLimitName == '12hour')
        state.timeLimit = {
          type: 'fixed',
          base: 43200,
        };
      else
        state.timeLimit = timeLimit[game.timeLimitName].clone();

      if (state.timeLimit.type === 'buffered') {
        if (state.startedAt)
          for (const [ t, team ] of state.teams.entries()) {
            if (!state.timeLimit.buffers)
              state.timeLimit.buffers = [];
            state.timeLimit.buffers[t] = team.turnTimeBuffer;
            delete team.turnTimeBuffer;
          }
        delete state.turnTimeBuffer;
      }
      delete state.turnTimeLimit;

      if (state.startedAt && !state.endedAt) {
        if (state.timeLimit.type === 'fixed')
          state.timeLimit.current = state.timeLimit.base;
        else if (state.timeLimit.type === 'buffered') {
          const currentTeamId = state.turns.length % state.teams.length;
          state.timeLimit.current = state.timeLimit.base + state.timeLimit.buffers[currentTeamId];
        }
      }
    }

    return json;
  },
  json => {
    const game = json.$data;
    const state = game.state;

    if (state.startedAt)
      state.turns.push({
        startedAt: state.turnStartedAt,
        units: state.units,
        actions: state.actions,
      });

    if (state.rated && state.lockedTurnId)
      state.turns[state.lockedTurnId + 1].isLocked = true;

    if (state.endedAt)
      state.turns.last.actions.push({
        type: 'endGame',
        forced: true,
        winnerId: state.winnerId,
        createdAt: state.endedAt,
      });

    delete state.startedAt;
    if (state.timeLimit)
      delete state.timeLimit.buffers;
    delete state.lockedTurnId;
    delete state.turnStartedAt;
    delete state.units;
    delete state.actions;
    delete state.endedAt;
    delete state.winnerId;

    return json;
  },
  json => {
    const game = json.$data;
    const state = game.state;

    if (state.rated)
      state.unrankedReason = 'old';

    return json;
  },
  json => {
    const game = json.$data;
    const state = game.state;

    state.undoMode = !game.rated ? 'loose' : state.strictUndo ? 'strict' : 'normal';
    state.rated = state.ranked;
    state.unratedReason = state.unrankedReason;

    delete state.strictUndo;
    delete state.ranked;
    delete state.unrankedReason;

    return json;
  },
  json => {
    const game = json.$data;
    const state = game.state;

    if (state.rated)
      state.undoMode = state.strictUndo ? 'strict' : 'normal';

    return json;
  },
]);

migrationMap.set('sets', [
  (data, { playerId }) => {
    return {
      type: 'PlayerSets',
      data: { playerId, sets:data },
    };
  },
  json => {
    return {
      $type: json.type,
      $data: json.data,
    };
  },
  json => {
    const sets = json.$data.sets;
    const setsByType = new Map();

    for (const set of sets) {
      const typeSets = setsByType.get(set.type) ?? [];

      if (typeSets.length === 0) {
        set.id = 'default';
        set.name = 'Default';
      } else if (typeSets.length === 1) {
        set.id = 'alt1';
        set.name = 'Alternate 1';
      } else if (typeSets.length === 2) {
        set.id = 'alt2';
        set.name = 'Alternate 2';
      } else if (typeSets.length === 3) {
        set.id = 'alt3';
        set.name = 'Alternate 3';
      } else
        continue;

      typeSets.push(set);

      setsByType.set(set.type, typeSets);
    }

    json.$data.sets = [ ...setsByType.values() ].flat();

    return json;
  },
]);

migrationMap.set('stats', [
  (data, { playerId }) => {
    return {
      type: 'PlayerStats',
      data: { playerId, stats:data },
    };
  },
  json => {
    return {
      $type: json.type,
      $data: json.data,
    };
  },
]);

migrationMap.set('room', [
  data => {
    delete data.version;

    return { type:'Room', data };
  },
  json => {
    return {
      $type: json.type,
      $data: json.data,
    };
  },
]);

migrationMap.set('playerPush', [
  (json, { playerId }) => {
    json.playerId = playerId;
    json.subscriptions = new Map(json.subscriptions);

    return json;
  },
]);

/*
 * The base version for an object is version 1.
 * The first migration (index === 0) migrates version 1 to 2.
 */
export default (dataType, data, params) => {
  const migrations = migrationMap.get(dataType);
  if (!migrations)
    return data;

  const version = data.version ?? 1;
  const startIndex = version - 1;

  for (let i = startIndex; i < migrations.length; i++)
    data = migrations[i](data, params);

  data.version = migrations.length + 1;

  return data;
};

export function getLatestVersionNumber(dataType) {
  const migrations = migrationMap.get(dataType);
  if (!migrations)
    return 1;

  return migrations.length + 1;
};
