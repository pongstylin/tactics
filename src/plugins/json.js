Object.defineProperty(Set.prototype, 'toJSON', {
  value: function () {
    return [...this];
  },
});

Object.defineProperty(Map.prototype, 'toJSON', {
  value: function () {
    return [...this];
  },
});

Object.defineProperty(RegExp.prototype, 'toJSON', {
  value: function () {
    return { source:this.source, flags:this.flags };
  },
});

Object.defineProperty(URLSearchParams.prototype, 'toJSON', {
  value: function () {
    const obj = {}
    for (const [key, value] of this.entries()) {
      obj[key] = value;
    }
    return obj;
  },
});

Object.defineProperty(JSON, 'compress', {
  value: async function (data) {
    const stream = new Blob([ JSON.stringify(data) ], { type: 'application/json' }).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const arrayBuffer = await new Response(compressedStream).arrayBuffer();

    return new Uint8Array(arrayBuffer).toBase64().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
});

Object.defineProperty(JSON, 'decompress', {
  value: async function (data) {
    const bytes = Uint8Array.fromBase64(data.replace(/-/g, '+').replace(/_/g, '/'));
    const stream = new Blob([ bytes ]).stream();
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    const json = await new Response(decompressedStream).text();

    return JSON.parse(json);
  },
});