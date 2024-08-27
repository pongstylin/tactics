import '#plugins/index.js';
import AuthAdapter from '#data/FileAdapter/AuthAdapter.js';
import Player from '#models/Player.js';

const authAdapter = await new AuthAdapter().bootstrap();
const dryRun = true;
const stats = new Map([ [ true, 0 ], [ false, 0 ] ]);

for (const identityId of await authAdapter.listAllIdentityIds()) {
  const identity = await authAdapter._getIdentity(identityId);

  if (Player.identities.has(identity) !== identity.needsIndex)
    if (dryRun)
      console.log('Mismatch', Player.identities.has(identity), identity.needsIndex);
    else if (identity.needsIndex)
      Player.identities.add(identity);
    else
      Player.identities.archive(identity);

  stats.set(identity.needsIndex, stats.get(identity.needsIndex) + 1);
}

await authAdapter.cleanup();

console.log('stats', stats);
