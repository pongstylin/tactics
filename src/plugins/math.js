let proto = Object.getPrototypeOf(Math);

proto.clamp = function (number, min, max) {
  return Math.min(max, Math.max(min, number));
};
Object.defineProperty(proto, 'clamp', {enumerable: false});
