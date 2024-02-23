import { RegExpMatcher, englishDataset, englishRecommendedTransformers, pattern } from 'obscenity';

const obscenityConfig = {
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
};

// Fix titties to not require word boundary at start
obscenityConfig.blacklistedTerms[98].pattern.requireWordBoundaryAtStart = false;

// Fix Buttplug detection
obscenityConfig.blacklistedTerms[108].pattern.nodes[0].chars = 'butplug'.split('').map(c => c.charCodeAt(0));

export default new RegExpMatcher(obscenityConfig);
