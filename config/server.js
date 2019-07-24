export default {
  /*
   * Global Configuration
   */
  publicKey: process.env.PUBLIC_KEY,
  privateKey: process.env.PRIVATE_KEY,

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
