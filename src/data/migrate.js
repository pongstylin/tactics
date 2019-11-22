/*
 * The purpose of this module is to migrate the JSON representation of player
 * and game objects to the latest version.
 */
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
