// As applied by the original game.
const getKFromRating = rating => {
  if (rating < 1200)
    return 32 * 1;
  else if (rating < 1400)
    return 32 * 0.7;
  else
    return 32 * 0.5;
};

// Inspired by: https://www.geeksforgeeks.org/elo-rating-algorithm/
function _probability(rating1, rating2) {
  return 1.0 / (1.0 + Math.pow(10, (rating1 - rating2) / 400));
}

/**
 * Computes the updated Elo Ratings for two players. Returns an array of size 2, in which the first and second elements
 * are the updated ratings of the winner and loser respectively.
 * @param ratingWinner
 * @param ratingLoser
 * @param isDraw
 * @param scale
 */
export function computeElo(ratingWinner, ratingLoser, isDraw, scale = 1) {
  if (!Array.isArray(scale))
    scale = new Array(2).fill(scale);

  const pWinner = _probability(ratingLoser, ratingWinner);
  const pLoser = _probability(ratingWinner, ratingLoser);
  const ratings = [];

  if (isDraw) {
    ratings.push(Math.max(100, ratingWinner + getKFromRating(ratingWinner) * scale[0] * (0.5 - pWinner)));
    ratings.push(Math.max(100, ratingLoser + getKFromRating(ratingLoser) * scale[1] * (0.5 - pLoser)));
  } else {
    ratings.push(Math.max(100, ratingWinner + getKFromRating(ratingWinner) * scale[0] * (1 - pWinner)));
    ratings.push(Math.max(100, ratingLoser + getKFromRating(ratingLoser) * scale[1] * (0 - pLoser)));
  }

  return ratings;
}
