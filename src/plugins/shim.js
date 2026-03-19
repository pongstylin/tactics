// iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.2  Mobile/15E148 Safari/604.1
if (!Uint8Array.prototype.toBase64) {
  Uint8Array.prototype.toBase64 = function() {
    let binary = '';
    for (let i = 0; i < this.length; i++)
      binary += String.fromCharCode(this[i]);
    return btoa(binary);
  };
}
