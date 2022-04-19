import uuid from 'uuid/v4';
import https from 'https';
import express from 'express';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import util from 'util';
import DebugLogger from 'debug';
import * as fs from 'fs';
import passport from 'passport';
import 'plugins/index.js';
import fbauth from 'server/fbauth.js'
import config from 'config/server.js';
import { onConnect, onShutdown } from 'server/router.js';
import services, { servicesReady } from 'server/services.js';
import Timeout from 'server/Timeout.js';
import ServerError from 'server/Error.js';
import AccessToken from 'server/AccessToken.js';
import session from 'express-session';
import zlib from 'zlib';



fbauth();
const key = fs.readFileSync("localhost-key.pem", "utf-8");
const cert = fs.readFileSync("localhost.pem", "utf-8");

const PORT     = process.env.PORT;
const app      = express();
const server   = https.createServer({key,cert},app);
const wss      = new WebSocketServer({server});
const request  = DebugLogger('server:request');
const response = DebugLogger('server:response');
const report   = DebugLogger('server:report');


let requestId = 1;
app.use(
  session({
    secret: ['veryimportantsecret','notsoimportantsecret','highlyprobablysecret'], 
     name: "secretname", 
     cookie: {
      httpOnly: true,
      secure: true,
      sameSite: true,
      maxAge: 600000 // Time is in miliseconds
  },
    
    resave: false
  })
)
app.use((req, res, next) => {
  req.id = requestId++;
  next();
})

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

const API_PREFIX = config.apiPrefix;

app.get(API_PREFIX + '/status', (req, res, next) => {
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
app.post(API_PREFIX + '/report', (req, res) => {
  report(util.inspect(req.body, false, null));
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

  const gameService = services.get('game');
  const tokenValue = req.headers.authorization.replace(/^Bearer /, '');
  AccessToken.validate(tokenValue, { ignoreExpiration:true });

  const token = new AccessToken(tokenValue);
  const playerId = token.playerId;
  const notification = await gameService.getYourTurnNotification(playerId);

  res.send(notification);
}
app.get(API_PREFIX + '/notifications/yourTurn', (req, res, next) => {
  getYourTurnNotification(req, res).catch(error => next(error));
});
app.use(passport.initialize());

app.get('/auth/:provider',  function(req, res,next) {passport.authenticate(req.params.provider)(req,res,next);});
app.get('/auth/:provider/callback',function(req, res,next) {
  const provider = req.params.provider;
  
  passport.authenticate(provider, { failureRedirect: '/login.html' })(req,res,next);}, function(req, res) { 
    const provider = req.params.provider;
  // Following above examples getting the authservice to being registration process
    const authService = services.get('auth');
  // request should have a user object which contains fb id and name: req.user.id req.user.displayName
  
    switch(provider.toLowerCase())
    {
      case 'facebook':
       
      authService.onRegisterRequest(req.user,{name:req.user.displayName,fbid:req.user.id}).then(token=>
      {
        
     token  = zlib.deflateSync(JSON.stringify(token)).toString('hex');
      //set query string to get online.js to call server's sync token method
        res.redirect('/online.html?id='+token) } // auth success

      );  
      break;
      }});
app.use(express.static('static'));

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
  server.listen(PORT, () => {
    console.log('Tactics now running at URL: http://localhost:'+PORT);
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

process.once('SIGINT', async () => {
  console.log('Press Ctrl+C again to shutdown immediately.');

  try {
    console.log('Initiating graceful shutdown of the server.');
    await new Promise((resolve, reject) => {
      wss.close(resolve);
      onShutdown();
    });

    console.log('Initiating cleanup...');
    await Promise.all([ ...services ].map(([ n, s ]) => s.cleanup()));

    console.log('Terminating...');
    process.exit(0);
  } catch (e) {
    console.log('Unable to gracefully terminate the process.');
    console.error(e);
    process.exit(1);
  }
});
