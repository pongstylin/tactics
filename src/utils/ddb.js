import zlib from 'zlib';

function getStringSize(str) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  return encoded.length;
}
function getNumberSize(num) {
  return val.toString().length;
}
function getBooleanSize(bool) {
  return 1;
}
function getNullSize() {
  return 1;
}
function getValueSize(val) {
  if (typeof val === 'string')
    return getStringSize(val);
  else if (typeof val === 'number')
    return getNumberSize(val);
  else if (typeof val === 'boolean')
    return getBooleanSize(val);
  else if (val === null)
    return getNullSize();
  else if (val === undefined)
    return 0;
  else if (Buffer.isBuffer(val))
    return val.length;
  throw new Error(`Unable to compute value size: ${typeof val}`);
}
export function getItemSize(item, doCompress = false) {
  if (doCompress)
    item = Object.assign({}, item, {
      D: item.D ? compress(item.D) : undefined,
      PD: item.PD ? compress(item.PD) : undefined,
    });

  let size = 0;
  for (const [ key, val ] of Object.entries(item)) {
    size += getStringSize(key);
    size += getValueSize(val);
  }

  return size;
}
export function getItemWCU(item) {
  const size = getItemSize(item);
  const numIndexes = Array.from(Object.entries(item)).filter(([ k, v ]) => v !== undefined && indexKeys.has(k)).length;

  return Math.ceil(size / 1024) * (1 + numIndexes);
}
export function compress(str) {
  if (str === undefined)
    return str;
  if (typeof str !== 'string')
    throw new Error('Unable to compress');

  return zlib.brotliCompressSync(str, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: str.length,
    },
  });
}
