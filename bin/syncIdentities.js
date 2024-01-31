import '#plugins/index.js';
import AuthAdapter from '#data/FileAdapter/AuthAdapter.js';
import Player from '#models/Player.js';

const authAdapter = await new AuthAdapter().bootstrap();

for (const identityId of await authAdapter.listAllIdentityIds()) {
  const identity = await authAdapter._getIdentity(identityId);
  Player.identities.add(identity);
}

await authAdapter.cleanup();
