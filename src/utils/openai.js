import OpenAI from 'openai';
import sleep from './sleep.js';

// Guard against this module ever running in a browser bundle. If it were
// bundled client-side, dotenv-webpack would inline OPENAI_API_KEY as a
// literal string, exposing it via DevTools. Only initialize server-side.
const openai = (typeof window === 'undefined' && process.env.OPENAI_API_KEY) ? new OpenAI() : null;

export async function moderationException(text, retries = 3, delay = 1000) {
  if (!openai) return false;

  for (let i = 0; i < retries; i++) {
    try {
      const moderation = await openai.moderations.create({
        model: 'omni-moderation-latest',
        input: text,
      });
      const result = moderation.results[0];

      if (result.flagged) {
        const reason = Object.entries(result.categories)
          .filter(([_, flagged]) => flagged)
          .map(([category, _]) => category)
          .sort((a,b) => result.category_scores[b] - result.category_scores[a])[0];

        if (reason !== 'violence')
          return `"${reason}" names are not allowed`;
      }

      return false;
    } catch (error) {
      if (error.status === 429 || error.status === 403 || error.status >= 500) {
        await sleep(delay);
        delay *= 2; // Exponential backoff
      } else {
        throw error; // Re-throw other errors
      }
    }
  }
  return `Unable to validate name.  Please try again later.`;
};