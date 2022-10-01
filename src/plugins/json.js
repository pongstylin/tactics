Object.defineProperty(Set.prototype, 'toJSON', {
  value: function () {
    return [...this];
  },
});

Object.defineProperty(Map.prototype, 'toJSON', {
  value: function () {
    return [...this];
  },
});

Object.defineProperty(RegExp.prototype, 'toJSON', {
  value: function () {
    return { source:this.source, flags:this.flags };
  },
});

Object.defineProperty(URLSearchParams.prototype, 'toJSON', {
  value: function () {
    const obj = {}
    for (const [key, value] of this.entries()) {
      obj[key] = value;
    }
    return obj;
  },
});
