
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
import zlib from 'zlib';
import serializer from 'utils/serializer.js';



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

app.get('/auth/facebook', passport.authenticate('facebook'));
app.get('/auth/facebook/callback',
  
  passport.authenticate('facebook', { failureRedirect: '/login.html' }), function(req, res) { 
  console.log("success"); 
  // Following above examples getting the authservice to being registration process
    const authService = services.get('auth');
  // request should have a user object which contains fb id and name: req.user.id req.user.displayName
  authService.onFBAuthorization(req.user,{fbUserData:req.user.id}).then(FBtoken=>{
        if(!FBtoken)
        authService.onRegisterRequest(req.user,{name:req.user.displayName,fbid:req.user.id}).then(token=>
        {
         token  = zlib.gzipSync(JSON.stringify(serializer.transform(token)));
          res.redirect('/online.html?id='+token.toString("hex"));
        });
        else{
         
        FBtoken  = zlib.gzipSync(JSON.stringify(serializer.transform(FBtoken)));
          res.redirect('/online.html?id='+FBtoken.toString("hex"));
      }  
      });
     
      
  }

  );
  app.get('/auth/discord', passport.authenticate('discord'));
  app.get('/auth/discord/callback',
    
    passport.authenticate('discord', { failureRedirect: '/login.html' }), function(req, res) { 
    
    // Following above examples getting the authservice to being registration process
      const authService = services.get('auth');
    // request should have a user object which contains fb id and name: req.user.id req.user.displayName
    authService.onDiscordAuthorization(req.user,{dcUserData:req.user.id}).then(dctoken=>{
          if(!dctoken)
          authService.onRegisterRequest(req.user,{name:req.user.displayName,discordid:req.user.id}).then(token=>
          {
           token  = zlib.gzipSync(JSON.stringify(serializer.transform(token)));
            res.redirect('/online.html?id='+token.toString("hex"));
          });
          else{
           
          dctoken  = zlib.gzipSync(JSON.stringify(serializer.transform(FBtoken)));
            res.redirect('/online.html?id='+dctoken.toString("hex"));
        }  
        });
      }
  
    );
           
  
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
