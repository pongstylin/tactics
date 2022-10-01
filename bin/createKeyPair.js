/*
 * Generate keys for JWT authentication.
 * This is only appropriate for a dev environment.
 * Production environments should have static keys.
 *
 * The auth service should have exclusive access to the private key.
 * Other services should use the public key to validate JWTs.
 */
import crypto from 'crypto';
import webpush from 'web-push';

const keys = crypto.generateKeyPairSync('rsa', {
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

const vapidKeys = webpush.generateVAPIDKeys();

const config = {
  publicKey: keys.publicKey,
  privateKey: keys.privateKey,
  push: {
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
  },
};

console.log(JSON.stringify(config, null, 2));
