Object.defineProperty(Set.prototype, 'equals', {
  value: function (set) {
    if (this.size !== set.size) return false;
    for (const value of this)
      if (!set.has(value)) return false;
    return true;
  },
});

Object.defineProperty(Set.prototype, 'intersect', {
  value: function (...sets) {
    let intersection = new Set();
    let values = [...this];
    let i, value;
    let j;

    VALUE: for (i = 0; i < values.length; i++) {
      value = values[i];

      for (j = 0; j < sets.length; j++) {
        if (!sets[j].has(value))
          continue VALUE;
      }

      intersection.add(value);
    }


    return intersection;
  },
});
