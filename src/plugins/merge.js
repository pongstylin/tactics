Object.defineProperty(Object, 'merge', {
  value: function (item1, item2) {
    if (item1 === null || typeof item1 !== 'object')
      return item2;

    return item1.merge(item2);
  },
});

Object.defineProperty(Object.prototype, 'merge', {
  writable: true,
  value: function (item) {
    if (item === null || typeof item !== 'object')
      return item;

    for (let key of Object.keys(item)) {
      this[key] = Object.merge(this[key], item[key]);
    }

    return this;
  },
});
Object.defineProperty(Set.prototype, 'merge', {
  value: function (item) {
    return item;
  }
});
Object.defineProperty(Map.prototype, 'merge', {
  value: function (item) {
    return item;
  }
});
Object.defineProperty(Date.prototype, 'merge', {
  value: function (item) {
    return item;
  }
});
