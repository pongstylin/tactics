const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const express = require('express');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({server});

// Setup express middleware
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// All routes should return the index.html page, since we're using client-side routing
app.get('*', (req, res) => {
  res.status(200).sendFile(path.resolve(__dirname, '..', 'public', 'index.html'));
});

server.listen(config.port, () => {
  // Listen to and handle web socket connections
  wss.on('connection', require('./core/socket/index'));
  console.info(`[info] Running on http://localhost:${config.port}`);
});
