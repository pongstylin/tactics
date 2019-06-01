/*
 * Generate keys for JWT authentication.
 * This is only appropriate for a dev environment.
 * Production environments should have static keys.
 *
 * The auth service should have exclusive access to the private key.
 * Other services should use the public key to validate JWTs.
 */
const crypto = require('crypto');

let keys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 1024,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  }
});

let config = {
  publicKey: keys.publicKey,
  privateKey: keys.privateKey,
};

console.log(JSON.stringify(config, null, 2));
