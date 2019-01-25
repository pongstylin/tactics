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

/*
 * Imagine spinning a wheel such that it may stop at any given position.  An
 * array that contains a sequence of repeatable items is like a wheel.  Spinning
 * the wheel does not change the order of the items, but it does randomize the
 * beginning of the sequence.
 *
 * Additionally, this method has a 50/50 chance of reversing the order.
 *
 * This modifies the original array.
 *
 * Examples:
 *   [1, 2, 3, 4] => [3, 4, 1, 2]
 *   [1, 2, 3, 4] => [2, 1, 4, 3]
 */
Array.prototype.spin = function () {
  var arr = this;
  var index = Math.floor(Math.random() * arr.length);
  while (index--) arr.push(arr.shift());

  if (Math.random() < 0.5) arr.reverse();

  return arr;
};
Object.defineProperty(Array.prototype, 'spin', {enumerable: false});

/*
 * Get the next index, which may be zero if given the last index.
 * Optionally filter the next index chosen using a callback function.
 */
Array.prototype.getNextIndex = function (index, filter) {
  let array = this;
  let length = array.length;

  index = (index + 1) % length;

  if (filter)
    while (!filter(array[index], index))
      index = (index + 1) % length;

  return index;
};
Object.defineProperty(Array.prototype, 'getNextIndex', {enumerable: false});

/*
 * Get an array of the array's indexes with an optional start index.
 */
Array.prototype.getAllIndexes = function (start) {
  let array = this;
  let indexes = array.map((item, i) => i);

  if (start)
    while (start--) indexes.push(indexes.shift());

  return indexes;
};
Object.defineProperty(Array.prototype, 'getAllIndexes', {enumerable: false});

Array.prototype.findLastIndex = function (filter) {
  let array = this;

  for (let i=array.length-1; i>-1; i--) {
    if (filter(array[i], i))
      return i;
  }

  return -1;
};
