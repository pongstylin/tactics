Object.defineProperty(Number, 'rangeOverlaps', {
  value: function (a1, a2, b1, b2 = b1) {
    if (a1 > a2) [a1, a2] = [a2, a1];
    if (b1 > b2) [b1, b2] = [b2, b1];

    return a1 <= b2 && b1 <= a2;
  },
});
