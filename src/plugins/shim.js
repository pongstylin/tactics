// iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.2  Mobile/15E148 Safari/604.1
if (!Uint8Array.prototype.toBase64) {
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    value: function () {
      let binary = '';
      for (let i = 0; i < this.length; i++)
        binary += String.fromCharCode(this[i]);
      return btoa(binary);
    },
  });
}

if (!Uint8Array.fromBase64) {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    value: function (base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
      return bytes;
    },
  });
}

if (typeof CompressionStream === 'undefined') {
  const fflatePromise = import('fflate');

  self.CompressionStream = class {
    constructor(format) {
      if (format !== 'gzip') throw new Error(`Unsupported format: ${format}`);
      let _controller;
      this.readable = new ReadableStream({
        start(controller) { _controller = controller; },
      });
      this.writable = new WritableStream({
        write: async chunk => {
          const { gzip } = await fflatePromise;
          return new Promise((resolve, reject) => {
            gzip(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), (err, data) => {
              if (err) { _controller.error(err); reject(err); }
              else { _controller.enqueue(data); resolve(); }
            });
          });
        },
        close: async () => {
          await fflatePromise;
          _controller.close();
        },
      });
    }
  };

  self.DecompressionStream = class {
    constructor(format) {
      if (format !== 'gzip') throw new Error(`Unsupported format: ${format}`);
      let _controller;
      this.readable = new ReadableStream({
        start(controller) { _controller = controller; },
      });
      this.writable = new WritableStream({
        write: async chunk => {
          const { gunzip } = await fflatePromise;
          return new Promise((resolve, reject) => {
            gunzip(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), (err, data) => {
              if (err) { _controller.error(err); reject(err); }
              else { _controller.enqueue(data); resolve(); }
            });
          });
        },
        close: async () => {
          await fflatePromise;
          _controller.close();
        },
      });
    }
  };
}