import ServerSocket from 'client/ServerSocket.js';
import AuthClient from 'client/AuthClient.js';
import GameClient from 'client/GameClient.js';
import config from 'config/client.js';

let endpoints = new Map([
  ['auth', config.authEndpoint],
  ['game', config.gameEndpoint],
]);

let sockets = new Map();
let clients = new Map();

export default serviceName => {
  let endpointName = endpoints.get(serviceName);

  // Only one socket per endpoint
  if (!sockets.has(endpointName))
    sockets.set(endpointName, new ServerSocket(endpointName));

  // Only one client per service
  if (!clients.has(serviceName))
    if (serviceName === 'auth')
      clients.set(serviceName, new AuthClient(sockets.get(endpointName)));
    else if (serviceName === 'game')
      clients.set(serviceName, new GameClient(sockets.get(endpointName)));
    else
      throw new TypeError('No such service');

  return clients.get(serviceName);
};
