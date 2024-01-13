/*
 * This is useful for testing or recovering a player's account.
 */
import '#plugins/index.js';
import AuthAdapter from '#data/FileAdapter/AuthAdapter.js';

const playerId = process.argv[2];
const tokenValue = process.argv[3];
const dataAdapter = await new AuthAdapter().bootstrap();
const player = await dataAdapter.getPlayer(playerId);

if (tokenValue) {
  if (player.identityToken) {
    console.log('There is a conflict with an existing token');
    process.exit(1);
  }

  player.setIdentityToken(tokenValue);

  console.log('Token restored');
} else {
  if (player.identityToken) {
    console.log('Using an existing identity token.');
    console.log(`  To restore: npm run script bin/createIdentityToken.js ${playerId} ${player.identityToken}`);
    console.log('');
  } else {
    player.setIdentityToken();
  }

  console.log(`/addDevice.html?${player.identityToken.value}`);
}

await dataAdapter.cleanup();
