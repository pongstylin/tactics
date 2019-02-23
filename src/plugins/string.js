String.prototype.capitalize = function () {
  return this.charAt(0).toUpperCase() + this.slice(1).toLowerCase();
};
Object.defineProperty(String.prototype, 'capitalize', {enumerable: false});
