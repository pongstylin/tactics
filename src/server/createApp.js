import DebugLogger from 'debug';
import express from 'express';
import morgan from 'morgan';

const app = express();
const request = DebugLogger('server:request');
const response = DebugLogger('server:response');

let requestId = 1;
app.use((req, res, next) => {
  req.id = requestId++;
  next();
});

morgan.token('id', req => req.id);

app.use(morgan('[:id] ip=:remote-addr; ":method :url HTTP/:http-version"; agent=":user-agent"', {
  immediate: true,
  stream: { write: msg => request(msg.slice(0, -1)) },
}));

app.use(morgan('[:id] status=:status; delay=:response-time ms', {
  immediate: false,
  stream: { write: msg => response(msg.slice(0, -1)) },
}));

app.use(express.json());
app.use(express.static('static'));

export default () => app;
