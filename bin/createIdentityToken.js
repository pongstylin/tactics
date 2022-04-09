/*
 * This is useful for testing or recovering a player's account.
 */
import 'plugins/array.js';
import 'plugins/set.js';
import 'plugins/map.js';
import 'plugins/string.js';
import AuthAdapter from 'data/DataAdapter/AuthAdapter.js';

const dataAdapter = new AuthAdapter();

let playerId = process.argv[2];
let tokenValue = process.argv[3];

(async () => {
  let player = await dataAdapter.getPlayer(playerId);

  if (tokenValue) {
    if (player.identityToken) {
      console.log('There is a conflict with an existing token');
      process.exit(1);
    }

    player.setIdentityToken(tokenValue);
    await dataAdapter.cleanup();

    console.log('Token restored');
  }
  else {
    if (player.identityToken) {
      console.log('Using an existing identity token.');
      console.log(`  To restore: npm run script bin/createIdentityToken.js ${playerId} ${player.identityToken}`);
      console.log('');
    }
    else {
      player.setIdentityToken();
      await dataAdapter.cleanup();
    }

    console.log(`/addDevice.html?${player.identityToken.value}`);
  }
})();
