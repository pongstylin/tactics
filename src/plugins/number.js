Object.defineProperty(Number, 'rangeOverlaps', {
  value: function (a1, a2, b1, b2 = b1) {
    if (a1 > a2) [a1, a2] = [a2, a1];
    if (b1 > b2) [b1, b2] = [b2, b1];

    return a1 <= b2 && b1 <= a2;
  },
});

const base62Chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const toBase62 = int => {
  let intChars = '';
  do {
    intChars = base62Chars[int % 62] + intChars;
    int = Math.floor(int / 62);
  } while (int > 0)
  return intChars;
};
Object.defineProperty(Number.prototype, 'toSortableString', {
  value: function (intLength = 4, decLength = 4) {
    if (!intLength) return '';

    const numParts = Math.abs(this).toString().split('.');
    const parts = [];

    let int = Number(numParts[0]);
    if (int >= base62Chars.length ** intLength)
      throw new Error(`Number is too large to fit into ${intLength} characters`);
    parts.push(toBase62(int).padStart(intLength, '0'));

    let dec = numParts.length > 1 ? Number(`0.${numParts[1]}`) : 0;
    if (dec && decLength)
      parts.push(toBase62(Math.floor(dec * base62Chars.length ** decLength)).padEnd(decLength, '0'));

    return (this < 0 ? '-' : '') + parts.join('.');
  },
});