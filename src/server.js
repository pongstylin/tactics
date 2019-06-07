import uuid from 'uuid/v4';
import http from 'http';
import express from 'express';
import morgan from 'morgan';
import ws from 'ws';

/*
 * Normally, different services would run on different servers.
 * But the dev environment runs all services in one.
 */
import 'server/AuthService.js';
import 'server/GameService.js';

// Order matters, services must be loaded before router.
import router from 'server/router.js';

// Object extensions/polyfills
import 'plugins/array.js';

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
  console.log(new Date().toISOString() + ' uncaught exception:', error);
});
