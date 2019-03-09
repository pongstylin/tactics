Math.clamp = function (number, min, max) {
  return Math.min(max, Math.max(min, number));
};
Object.defineProperty(Math, 'clamp', {enumerable: false});
