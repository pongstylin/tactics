import '#plugins/index.js';
import AuthAdapter from '#data/FileAdapter/AuthAdapter.js';

const authAdapter = await new AuthAdapter({ hasState:false }).bootstrap();

for (const identityId of await authAdapter.listAllIdentityIds()) {
  const identity = await authAdapter._getIdentity(identityId);
  const players = await Promise.all(identity.playerIds.map(pId => authAdapter._getPlayer(pId)));
  const mostRecentlySeenPlayer = players.filter(p => p.verified).max(p => p.lastSeenAt);

  if (mostRecentlySeenPlayer)
    identity.name = mostRecentlySeenPlayer.name;
}

await authAdapter.cleanup();
