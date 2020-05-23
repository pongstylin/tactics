Object.defineProperty(Object, 'getProperties', {
  value: function (item) {
    let props = {};
    for (let name of Object.getOwnPropertyNames(item)) {
      let descriptors = Object.getOwnPropertyDescriptor(item, name);
      descriptors.value = Object.clone(descriptors.value);

      props[name] = descriptors;
    }

    return props;
  },
});

Object.defineProperty(Object, 'clone', {
  value: function (item) {
    if (item === null || typeof item !== 'object')
      return item;

    return item.clone();
  },
});

Object.defineProperty(Object.prototype, 'clone', {
  writable: true,
  value: function () {
    return Object.create(Object.getPrototypeOf(this), Object.getProperties(this));
  },
});
Object.defineProperty(Array.prototype, 'clone', {
  writable: true,
  value: function () {
    let obj = this.map(v => Object.clone(v));
    Object.defineProperties(obj, Object.getProperties(this));
    return obj;
  },
});
Object.defineProperty(Set.prototype, 'clone', {
  value: function () {
    let obj = new Set([...this]);
    Object.defineProperties(obj, Object.getProperties(this));
    return obj;
  },
});
Object.defineProperty(Map.prototype, 'clone', {
  value: function () {
    let obj = new Map([...this]);
    Object.defineProperties(obj, Object.getProperties(this));
    return obj;
  },
});
Object.defineProperty(Date.prototype, 'clone', {
  value: function () {
    let obj = new Date(this);
    Object.defineProperties(obj, Object.getProperties(this));
    return obj;
  },
});
