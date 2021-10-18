/*
 * The purpose of this module is to migrate the JSON representation of player
 * and game objects to the latest version.
 */
import unitDataMap from 'tactics/unitData.js';
import GameType from 'tactics/GameType.js';

const MIGRATIONS = {};

MIGRATIONS.player = [
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
];

MIGRATIONS.game = [
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
];

/*
 * The base version for an object is version 1.
 * The first migration (index === 0) migrates version 1 to 2.
 */
export default (dataType, data) => {
  if (data.version === undefined)
    data.version = 1;

  let migrations = MIGRATIONS[dataType];
  if (!migrations)
    return data;

  let startIndex = data.version - 1;

  for (let i = startIndex; i < migrations.length; i++)
    data = migrations[i](data);

  data.version = migrations.length + 1;

  return data;
};

export function getLatestVersionNumber(dataType) {
  let migrations = MIGRATIONS[dataType];
  if (!migrations)
    return 1;

  return migrations.length + 1;
};
