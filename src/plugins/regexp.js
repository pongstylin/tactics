Object.defineProperty(RegExp.prototype, 'toJSON', {
  value: function () {
    return { source:this.source, flags:this.flags };
  },
});
