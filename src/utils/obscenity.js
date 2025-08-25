import { RegExpMatcher, englishDataset, englishRecommendedTransformers, pattern } from 'obscenity';
import decancer from '#utils/decancer.js';

const obscenityConfig = {
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
};

// Fix titties to not require word boundary at start
obscenityConfig.blacklistedTerms[98].pattern.requireWordBoundaryAtStart = false;

// Fix Buttplug detection
obscenityConfig.blacklistedTerms[108].pattern.nodes[0].chars = 'butplug'.split('').map(c => c.charCodeAt(0));

// Add Wank
obscenityConfig.blacklistedTerms.push({
  id: obscenityConfig.blacklistedTerms.length,
  pattern: {
    requireWordBoundaryAtStart: false,
    requireWordBoundaryAtEnd: false,
    nodes: [
      { kind:2, chars:'wank'.split('').map(c => c.charCodeAt(0)) }
    ],
  },
});

const matcher = new RegExpMatcher(obscenityConfig);

export default {
  hasMatch: text => {
    return matcher.hasMatch(text)
      || matcher.hasMatch(decancer(text))
      || matcher.hasMatch(decancer(text).replace(/l/g, 'I'))
      || matcher.hasMatch(decancer(text).replace(/!/g, 'I'));
  },
};
