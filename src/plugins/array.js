Array.prototype.random = function () {
  return this[Math.floor(Math.random() * this.length)];
};
Object.defineProperty(Array.prototype, 'random', {enumerable: false});

Array.prototype.shuffle = function () {
  var arr = this;
  var currentIndex = arr.length, temporaryValue, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = arr[currentIndex];
    arr[currentIndex] = arr[randomIndex];
    arr[randomIndex] = temporaryValue;
  }

  return arr;
};
Object.defineProperty(Array.prototype, 'shuffle', {enumerable: false});

Array.prototype.spin = function () {
  var arr = this;
  var index = Math.floor(Math.random() * arr.length);
  while (index--) arr.push(arr.shift());

  if (Math.random() < 0.5) arr.reverse();

  return arr;
};
Object.defineProperty(Array.prototype, 'spin', {enumerable: false});
