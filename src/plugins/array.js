Object.defineProperty(Array.prototype, 'random', {
  writeable: false,
  enumerable: false,
  value: function () {
    return this[Math.floor(Math.random() * this.length)];
  },
});

Object.defineProperty(Array.prototype, 'shuffle', {
  writeable: false,
  enumerable: false,
  value: function () {
    let array = this;
    let currentIndex = array.length, temporaryValue, randomIndex;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
      // Pick a remaining element...
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;

      // And swap it with the current element.
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }

    return array;
  },
});

Object.defineProperty(Array.prototype, 'findLastIndex', {
  writeable: false,
  enumerable: false,
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
  enumerable: false,
  get: function () {
    return this[this.length-1];
  },
});

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/flat
// This is required for NodeJS 10.x
if (!Array.prototype.flat) {
  Array.prototype.flat = function() {
    var depth = arguments[0];
    depth = depth === undefined ? 1 : Math.floor(depth);
    if (depth < 1) return Array.prototype.slice.call(this);
    return (function flat(arr, depth) {
      var len = arr.length >>> 0;
      var flattened = [];
      var i = 0;
      while (i < len) {
        if (i in arr) {
          var el = arr[i];
          if (Array.isArray(el) && depth > 0)
            flattened = flattened.concat(flat(el, depth - 1));
          else flattened.push(el);
        }
        i++;
      }
      return flattened;
    })(this, depth);
  };
}
