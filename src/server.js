import uuid from 'uuid/v4';
import http from 'http';
import express from 'express';
import morgan from 'morgan';
import ws from 'ws';

// Object extensions/polyfills
import 'plugins/array.js';
import 'plugins/string.js';

import router from 'server/router.js';

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

app.post('/errors', (req, res) => {
  console.log('client errors:', req.body);
  res.send(true);
});

app.use(express.static('static'));

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
