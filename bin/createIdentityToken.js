/*
 * This is useful for testing or recovering a player's account.
 */
import dataFactory from 'data/adapterFactory.js';

const dataAdapter = dataFactory();

let playerId = process.argv[2];
let tokenValue = process.argv[3];

(async () => {
  let player = await dataAdapter.getPlayer(playerId);

  if (tokenValue) {
    if (player.identityToken) {
      console.log('There is a conflict with an existing token');
      process.exit(1);
    }

    player.identityToken = tokenValue;

    await dataAdapter.savePlayer(player);

    console.log('Token restored');
  }
  else {
    if (player.identityToken) {
      console.log('Using an existing identity token.');
      console.log(`  To restore: npm run script bin/createIdentityToken.js ${playerId} ${player.identityToken}`);
      console.log('');

      tokenValue = player.identityToken.value;
    }
    else {
      tokenValue = (await dataAdapter.createIdentityToken(playerId)).identityToken.value;
    }

    console.log(`/addDevice.html?${tokenValue}`);
  }
})();
