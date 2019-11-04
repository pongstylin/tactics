import pkg from '../package.json';

export default {
  version: pkg.version,

  /*
   * Global Configuration
   */
  apiPrefix: process.env.API_PREFIX,
  publicKey: process.env.PUBLIC_KEY,
  privateKey: process.env.PRIVATE_KEY,

  // Service endpoints required for inter-service communication.
  // This server only accepts messages directed to 'local' services.
  endpoints: new Map([
    ['auth', 'local'],
    ['game', 'local'],
    ['chat', 'local'],
    ['push', 'local'],
  ]),

  /*
   * Push Service Configuration.
   */
  push: {
    /*
     * The `subject` should be 'mailto:' link with your email address or the URL
     * of the site generating push notifications.  For development purposes, it
     * can be set to the localhost URL, which should indicate the notifications
     * are sent for testing purposes.  This information is included when pushing
     * a notification to the push service.  If possible, they might contact you
     * if you are accidentally flooding their service with pushed notifications.
     */
    subject: process.env.PN_SUBJECT,
    publicKey: process.env.PN_PUBLIC_KEY,
    privateKey: process.env.PN_PRIVATE_KEY,
  },
};
