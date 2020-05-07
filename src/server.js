import uuid from 'uuid/v4';
import http from 'http';
import express from 'express';
import morgan from 'morgan';
import ws from 'ws';
import util from 'util';

// Object extensions/polyfills
import 'plugins/array.js';
import 'plugins/set.js';
import 'plugins/map.js';
import 'plugins/string.js';

import config from 'config/server.js';
import router from 'server/router.js';
import GameService from 'server/GameService.js';
import ServerError from 'server/Error.js';
import AccessToken from 'server/AccessToken.js';

const PORT   = process.env.PORT;
const app    = express();
const server = http.createServer(app);
const wss    = new ws.Server({server});

let requestId = 1;
app.use((req, res, next) => {
  req.id = requestId++;
  next();
});

morgan.token('id', req => req.id);

app.use(morgan(':date[iso] express [:id] request-in: ip=:remote-addr; ":method :url HTTP/:http-version"; agent=":user-agent"', {
  immediate: true,
}));

app.use(morgan(':date[iso] express [:id] response-out: status=:status; delay=:response-time ms', {
  immediate: false,
}));

app.use(express.json());

const API_PREFIX = config.apiPrefix || '';

app.get(API_PREFIX + '/version', (req, res) => {
  res.send({ version:config.version });
});
app.post(API_PREFIX + '/errors', (req, res) => {
  console.log('client errors:', util.inspect(req.body, false, null, true));
  res.send(true);
});

/*
 * Called from a service worker when it receives a 'yourTurn' notification.
 * Used to determine the current notification for the player irregardless
 * of the received notification, which may be out-of-date.
 */
async function getYourTurnNotification(req, res) {
  if (!req.headers.authorization)
    throw new ServerError(401, 'Authorization is required');

  let tokenValue = req.headers.authorization.replace(/^Bearer /, '');
  let token = AccessToken.verify(tokenValue, { ignoreExpiration:true });
  let playerId = token.playerId;
  let notification = await GameService.getYourTurnNotification(playerId);

  res.send(notification);
}
app.get(API_PREFIX + '/notifications/yourTurn', (req, res, next) => {
  getYourTurnNotification(req, res).catch(error => next(error));
});

app.use(express.static('static'));

app.use((error, req, res, next) => {
  if (error instanceof ServerError)
    return res.status(error.code).send({ error });

  res.status(500).send({ error:{
    message: 'Internal Server Error',
  }});

  console.error(error.stack)
});

// Don't start listening for connections until the router is ready.
router.then(route => {
  server.listen(PORT, () => {
    console.log('Tactics now running at URL: http://localhost:'+PORT);
    console.log('');

    wss.on('connection', route);
  });
});

/*
 * Very crude exception handling.  Only appropriate for a dev server.
 * Clustering should be used in production environments.
 */
process.on('uncaughtException', error => {
  console.log(new Date().toISOString() + ' uncaught exception:', error);
});
