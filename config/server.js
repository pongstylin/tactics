import crypto from 'crypto';

import pkg from '#package.json' with { type:'json' };
import gameTypes from '#data/files/game/game_types.json' with { type:'json' };

const authAlg = 'aes256';
const authKey = crypto.randomBytes(32);
const authIV = crypto.randomBytes(16);

const gameTypeIds = gameTypes.filter(gt => !gt[1].archived).map(gt => gt[0]);
const config = {
  version: pkg.version,

  auth: {
    // Automatically enable if any providers have credentials.
    enabled: 'auto',
    encryptState: state => {
      const authCipher = crypto.createCipheriv(authAlg, authKey, authIV);
      return authCipher.update(state, 'utf-8', 'base64') + authCipher.final('base64');
    },
    decryptState: state => {
      const authDecipher = crypto.createDecipheriv(authAlg, authKey, authIV);
      return authDecipher.update(state, 'base64', 'utf-8') + authDecipher.final('utf-8');
    },
    // Providers without client credentials are automatically ignored.
    providers: {
      discord: {
        issuer: {
          authorization_endpoint: 'https://discord.com/oauth2/authorize',
          token_endpoint: 'https://discord.com/api/oauth2/token',
          userinfo_endpoint: 'https://discord.com/api/users/@me',
        },
        client: {
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
        },
        authorization: {
          response_type: 'code',
          // Automatically prefixed below with the local path, if any
          redirect_uri: '/auth/callback',
          //scope: [ 'activities.write', 'guilds.members.read', 'identify' ],
          scope: 'identify guilds.members.read',
          code_challenge_method: 'S256',
        },
      },
      facebook: {
        openId: 'https://www.facebook.com',
        issuer: {
          token_endpoint: 'https://graph.facebook.com/v15.0/oauth/access_token',
          userinfo_endpoint: 'https://graph.facebook.com/v15.0/me',
        },
        client: {
          client_id: process.env.FACEBOOK_CLIENT_ID,
          client_secret: process.env.FACEBOOK_CLIENT_SECRET,
        },
        authorization: {
          response_type: 'code',
          // Automatically prefixed below with the local path, if any
          redirect_uri: '/auth/callback',
          code_challenge_method: 'S256',
        },
      },
    },
  },

  /*
   * Global Configuration
   */
  local: {
    secure: process.env.LOCAL_SECURE === 'true',
    host: process.env.LOCAL_HOST,
    port: process.env.LOCAL_PORT ? parseInt(process.env.LOCAL_PORT) : null,
    // The optional path part of API and WS endpoints.  Must not end with /
    path: process.env.LOCAL_PATH,

    // URLs constructed below
    origin: null,
    apiEndpoint: null,
  },
  proxy: {
    secure: process.env.PROXY_SECURE === 'true',
    host: process.env.PROXY_HOST,
    port: process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT) : null,
    // The optional path part of API and WS endpoints.  Must not end with /
    path: process.env.PROXY_PATH,
  },
  publicKey: process.env.PUBLIC_KEY,
  privateKey: process.env.PRIVATE_KEY,

  /*
   * Configure how long objects are cached.
   */
  cache: {
    expireIn: 60 * 60000,
  },

  /*
   * Configure how often buffered object changes are persisted.
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
        module: '#server/AuthService.js',
        dataAdapterModule: '#data/DynamoDBAdapter/AuthAdapter.js',
      },
    ],
    [
      'game',
      {
        module: '#server/GameService.js',
        dataAdapterModule: '#data/DynamoDBAdapter/GameAdapter.js',
        config: {
          collections: [
            {
              name: 'public',
              gameOptions: {
                defaults: {
                  randomFirstTurn: true,
                  undoMode: 'normal',
                  autoSurrender: false,
                  rated: null,
                  timeLimitName: 'week',
                },
                schema: {
                  timeLimitName: `enum([ 'week', 'day' ])`,
                },
              },
            },
            {
              name: 'lobby',
              numActiveGamesPerPlayer: 1,
              gameOptions: {
                defaults: {
                  randomFirstTurn: true,
                  undoMode: 'normal',
                  autoSurrender: true,
                  rated: null,
                  timeLimitName: 'standard',
                },
                schema: {
                  autoSurrender: 'const(true)',
                  timeLimitName: `enum([ 'blitz', 'standard', 'pro' ])`,
                },
              },
              collections: gameTypeIds.map(gtId => ({
                name: gtId,
                numPendingGamesPerPlayer: 1,
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
        module: '#server/ChatService.js',
        dataAdapterModule: '#data/DynamoDBAdapter/ChatAdapter.js',
      },
    ],
    [
      'push',
      {
        module: '#server/PushService.js',
        dataAdapterModule: '#data/DynamoDBAdapter/PushAdapter.js',
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

const local = config.local;
const proxy = config.proxy;
const context = config.proxy.host ? config.proxy : config.local;
if (context.secure) {
  local.origin = `https://`;
} else {
  local.origin = `http://`;
}
local.origin += context.host;
local.port ??= local.defaultPort = local.secure ? 443 : 80;
proxy.port ??= proxy.defaultPort = proxy.secure ? 443 : 80;

if (context.port !== context.defaultPort) {
  local.origin += `:${context.port}`;
  local.apiEndpoint += `:${context.port}`;
}
local.apiEndpoint = local.origin;

if (context.path) {
  local.apiEndpoint += context.path;
}

config.origin = config.proxy.origin ?? config.local.origin;

/*
 * Prune auth providers that are not configured.
 */
for (const provider of Object.keys(config.auth.providers)) {
  const providerConfig = config.auth.providers[provider];
  if (!providerConfig.client.client_id)
    delete config.auth.providers[provider];

  if (providerConfig.authorization.redirect_uri.startsWith('/'))
    providerConfig.authorization.redirect_uri = local.apiEndpoint + providerConfig.authorization.redirect_uri;
}
if (config.auth.enabled === 'auto')
  config.auth.enabled = Object.keys(config.auth.providers).length > 0;

export default config;
