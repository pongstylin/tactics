Object.defineProperty(Map.prototype, 'toJSON', {
  value: function () {
    return [...this];
  },
});
