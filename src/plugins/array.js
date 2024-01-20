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

/*
 * fn() is expected to handle type checking and caching of expensive computations when required.
 */
Object.defineProperty(Array.prototype, 'max', {
  value: function (fn) {
    if (this.length === 0)
      return;

    if (!fn)
      return this.reduce((a, b) => {
        if (a === undefined)
          return b;
        if (b === undefined)
          return a;
        return a > b ? a : b;
      });

    const max = {
      item: this[0],
      value: fn(this[0]),
    };
    for (let i = 1; i < this.length; i++) {
      const item = this[i];
      const value = fn(item);
      if (value > max.value) {
        max.item = item;
        max.value = value;
      }
    }

    return max.item;
  },
});

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
/*
 * Sort the item before its peers.
 */
Object.defineProperty(Array.prototype, 'unshiftSorted', {
  value: function (item, cmp = compare) {
    const array = this;
    let low = 0;
    let high = array.length;
    let mid;

    while (low < high) {
      mid = (low + high) >>> 1;
      if (cmp(array[mid], item) < 0)
        low = mid + 1;
      else
        high = mid;
    }

    this.splice(low, 0, item);

    return low;
  },
});
/*
 * Sort the item after its peers.
 */
Object.defineProperty(Array.prototype, 'pushSorted', {
  value: function (item, cmp = compare) {
    const array = this;
    let low = 0;
    let high = array.length;
    let mid;

    while (low < high) {
      mid = (low + high) >>> 1;
      if (cmp(array[mid], item) > 0)
        high = mid;
      else
        low = mid + 1;
    }

    this.splice(low, 0, item);

    return low;
  },
});
