import '#plugins/index.js';
import AuthAdapter from '#data/FileAdapter/AuthAdapter.js';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

const authAdapter = await new AuthAdapter().bootstrap();
const playerIds = await authAdapter.listAllPlayerIds();
const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
});

for (const playerId of playerIds) {
  const player = await authAdapter._getPlayer(playerId);
  if (matcher.hasMatch(player.name))
    player.updateProfile({ name:'Noob' });
}

await authAdapter.cleanup();
