Object.defineProperty(Array.prototype, 'random', {
  value: function () {
    return this[Math.floor(Math.random() * this.length)];
  },
});

Object.defineProperty(Array.prototype, 'shuffle', {
  value: function () {
    for (let i = this.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));
      [this[i], this[j]] = [this[j], this[i]];
    }

    return this;
  },
});

Object.defineProperty(Array.prototype, 'findLastIndex', {
  value: function (filter) {
    let array = this;

    for (let i=array.length-1; i>-1; i--) {
      if (filter(array[i], i))
        return i;
    }

    return -1;
  },
});

Object.defineProperty(Array.prototype, 'last', {
  get: function () {
    return this[this.length-1];
  },
});
