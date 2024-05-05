import '#plugins/index.js';
import AuthAdapter from '#data/FileAdapter/AuthAdapter.js';
import obscenity from '#utils/obscenity.js';

const authAdapter = await new AuthAdapter().bootstrap();
const playerIds = await authAdapter.listAllPlayerIds();

for (const playerId of playerIds) {
  const player = await authAdapter._getPlayer(playerId);
  if (obscenity.hasMatch(player.name)) {
    for (let i = 1; i < 100; i++) {
      try {
        player.updateProfile({ name:i === 1 ? 'Noob' : `Noob${i}` });
        break;
      } catch (e) {}
    }
  }
}

await authAdapter.cleanup();
