Object.defineProperty(Object.prototype, 'pick', {
  value: function (...keys) {
    const picked = {};
    for (const key of keys)
      if (key in this)
        picked[key] = this[key];
    return picked;
  },
});
