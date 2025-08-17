import { WebSocketServer } from 'ws';
import util from 'util';
import DebugLogger from 'debug';
import '#plugins/index.js';

import config from '#config/server.js';
import AccessToken from '#server/AccessToken.js';
import IdentityToken from '#server/IdentityToken.js';
import createApp from '#server/createApp.js';
import createServer from '#server/createServer.js';
import ServerError from '#server/Error.js';
import { onConnect, onShutdown } from '#server/router.js';
import services, { servicesReady } from '#server/services.js';
import Timeout from '#server/Timeout.js';
import useAuth from '#server/useAuth.js';

const app    = createApp();
const server = createServer(app);
const wss    = new WebSocketServer({ server });
const report = DebugLogger('server:report');

if (config.proxy.host)
  app.enable('trust proxy');

useAuth(app);

const PATH = config.local.path;

app.get(`${PATH}/status`, (req, res, next) => {
  Promise.all([ ...services ].map(([ n, s ]) => s.getStatus().then(st => [ n, st ])))
    .then(servicesStatus => {
      const connections = Timeout.timeouts.get('inboundClient').size;
      const status = {
        server: {
          version: config.version,
          connections,
          sessions: connections + Timeout.timeouts.get('closedSession').size,
        },
      };

      for (const [ serviceName, serviceStatus ] of servicesStatus) {
        status[serviceName] = serviceStatus;
      }

      res.header('Cache-Control', 'no-store, max-age=0');
      res.send(status);
    })
    .catch(error => next(error));
});
app.post(`${PATH}/report`, (req, res) => {
  report(util.inspect(req.body, false, null));
  res.send(true);
});
app.post(`${PATH}/promote`, async (req, res) => {
  const tokenValue = req.headers.authorization?.replace(/^Bearer /, '');
  if (!tokenValue)
    return res.status(401).send({ error:'Authorization token is required' });

  try {
    IdentityToken.validate(tokenValue);
  } catch (error) {
    return res.status(401).send({ error:'Invalid authorization token' });
  }

  const token = new IdentityToken(tokenValue);
  if (!token.claims.admin)
    return res.status(403).send({ error:'Admin privileges are required' });

  const authService = services.get('auth');

  try {
    const player = await authService.getPlayer(token.playerId);
    player.identity.admin = true;
  } catch (error) {
    return res.status(404).send({ error:'Player not found' });
  }

  res.send({});
});

/*
 * Called from a service worker when it receives a 'yourTurn' notification.
 * Used to determine the current notification for the player irregardless
 * of the received notification, which may be out-of-date.
 */
async function getYourTurnNotification(req, res) {
  if (!req.headers.authorization)
    throw new ServerError(401, 'Authorization is required');

  const gameService = services.get('game');
  const tokenValue = req.headers.authorization.replace(/^Bearer /, '');
  AccessToken.validate(tokenValue, { ignoreExpiration:true });

  const token = new AccessToken(tokenValue);
  const playerId = token.playerId;
  const notification = await gameService.getYourTurnNotification(playerId);

  res.send(notification);
}
app.get(`${PATH}/notifications/yourTurn`, (req, res, next) => {
  getYourTurnNotification(req, res).catch(error => next(error));
});

app.use((error, req, res, next) => {
  if (error instanceof ServerError)
    return res.status(error.code).send({ error });

  res.status(500).send({ error:{
    message: 'Internal Server Error',
  }});

  console.error(error.stack)
});

// Don't start listening for connections until services are ready.
servicesReady.then(() => {
  server.listen(config.local.port, () => {
    console.log(`Tactics now running at URL: ${config.local.origin}`);
    console.log('');

    wss.on('connection', onConnect);
  });
});

/*
 * Very crude exception handling.  Only appropriate for a dev server.
 * Clustering should be used in production environments.
 */
process.on('uncaughtException', error => {
  console.log(new Date().toISOString() + ' uncaught exception:', error);
});

const shutdown = async () => {
  try {
    console.log('Initiating graceful shutdown of the server.');
    await new Promise((resolve, reject) => {
      wss.close(resolve);
      onShutdown();
    });

    console.log('Initiating cleanup...');
    await Promise.all([ ...services ].map(([ n, s ]) => s.cleanup()));

    process.exit(0);
  } catch (e) {
    console.log('Unable to gracefully terminate the process.');
    console.error(e);
    process.exit(1);
  }
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.on('exit', (code) => console.log(`Exiting with code ${code}.`));