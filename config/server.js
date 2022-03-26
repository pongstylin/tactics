import pkg from '../package.json';
import gameTypes from 'data/files/game/game_types.json';

const gameTypeIds = gameTypes.filter(gt => !gt[1].archived).map(gt => gt[0]);

export default {
  version: pkg.version,

  /*
   * Global Configuration
   */
  apiPrefix: process.env.API_PREFIX ?? '',
  publicKey: process.env.PUBLIC_KEY,
  privateKey: process.env.PRIVATE_KEY,

  /*
   * When using the FileAdapter, configure how long files are cached.
   */
  cache: {
    expireIn: 60 * 60000,
  },

  /*
   * When using the FileAdapter, configure how often buffered file changes are
   * flushed to disk.
   */
  buffer: {
    // Flush files at a maximum rate of every 5 seconds
    interval: 5000,
    // Buffer file changes for at least 2 minutes.
    expireIn: 2 * 60000,
    // The number of files to flush at one time (per file type).
    expireLimit: size => Math.ceil(size / 15),
  },

  services: new Map([
    [
      'auth',
      {
        module: 'server/AuthService.js',
        dataAdapterModule: 'data/FileAdapter/AuthAdapter.js',
      },
    ],
    [
      'game',
      {
        module: 'server/GameService.js',
        dataAdapterModule: 'data/FileAdapter/GameAdapter.js',
        config: {
          collections: [
            {
              name: 'public',
              gameOptions: {
                defaults: {
                  strictUndo: false,
                  autoSurrender: false,
                },
                schema: {
                  strictUndo: 'const(false)',
                  autoSurrender: 'const(false)',
                },
              },
            },
            {
              name: 'lobby',
              numPendingGamesPerPlayer: 1,
              gameOptions: {
                defaults: {
                  randomFirstTurn: true,
                  strictUndo: true,
                  autoSurrender: true,
                  turnTimeLimit: 'standard',
                },
                schema: {
                  randomFirstTurn: 'const(true)',
                  strictUndo: 'const(true)',
                  autoSurrender: 'const(true)',
                  turnTimeLimit: `enum([ 'blitz', 'standard' ])`,
                },
              },
              collections: gameTypeIds.map(gtId => ({
                name: gtId,
                gameType: gtId,
              })),
            },
          ],
        },
      },
    ],
    [
      'chat',
      {
        module: 'server/ChatService.js',
        dataAdapterModule: 'data/FileAdapter/ChatAdapter.js',
      },
    ],
    [
      'push',
      {
        module: 'server/PushService.js',
        dataAdapterModule: 'data/FileAdapter/PushAdapter.js',
        config: {
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
      },
    ],
  ]),
};
