import 'plugins/clone.js';

Object.defineProperty(Object, 'merge', {
  value: function (...items) {
    let value;

    for (const item of items) {
      if (item === undefined)
        continue;
      else if (value === undefined)
        value = Object.clone(item);
      else if (value === null || typeof value !== 'object')
        value = item;
      else
        value.merge(item);
    }

    return value;
  },
});

Object.defineProperty(Object.prototype, 'merge', {
  writable: true,
  value: function (item) {
    if (item === undefined)
      return this;
    else if (item === null || typeof item !== 'object')
      return item;

    for (const key of Object.keys(item)) {
      this[key] = Object.merge(this[key], item[key]);
    }

    return this;
  },
});
Object.defineProperty(Array.prototype, 'merge', {
  writable: true,
  value: function (item) {
    return item;
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
