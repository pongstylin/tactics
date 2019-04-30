import uuid from 'uuid/v4';
import http from 'http';
import express from 'express';
import ws from 'ws';

import router from 'server/router.js';

/*
 * Normally, different services would run on different servers.
 * But the dev environment runs all services in one.
 */
import 'server/AuthService.js';
import 'server/GameService.js';

// Object extensions/polyfills
import 'plugins/array.js';

const PORT   = process.env.PORT;
const app    = express();
const server = http.createServer(app);
const wss    = new ws.Server({server});

app.use(express.static('static'));

server.listen(PORT, () => {
  console.log('Tactics now running at URL: http://localhost:'+PORT);
  console.log('');

  wss.on('connection', router);
});

/*
 * Very crude exception handling.  Only appropriate for a dev server.
 * Clustering should be used in production environments.
 */
process.on('uncaughtException', error => {
  console.log('uncaught exception:', error);
});
