let toUpperCase = String.prototype.toUpperCase;
Object.defineProperty(String.prototype, 'toUpperCase', {
  value: function () {
    if (arguments[0] === 'first')
      return toUpperCase.call(this[0]) + this.slice(1);

    return toUpperCase.call(this, arguments);
  }
});
