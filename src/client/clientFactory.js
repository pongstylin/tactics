import ServerSocket, { CLOSE_INACTIVE } from 'client/ServerSocket.js';
import AuthClient from 'client/AuthClient.js';
import GameClient from 'client/GameClient.js';
import ChatClient from 'client/ChatClient.js';
import PushClient from 'client/PushClient.js';
import config from 'config/client.js';

let endpoints = new Map([
  ['auth', config.authEndpoint],
  ['game', config.gameEndpoint],
  ['chat', config.chatEndpoint],
  ['push', config.pushEndpoint],
]);

let sockets = new Map();
let clients = new Map();

// Instantiate auth client first since it is required by other clients.
let authEndpoint = endpoints.get('auth');
sockets.set(authEndpoint, new ServerSocket(authEndpoint));
clients.set('auth', new AuthClient(sockets.get(authEndpoint)));

export default serviceName => {
  let endpointName = endpoints.get(serviceName);

  // Only one socket per endpoint
  if (!sockets.has(endpointName))
    sockets.set(endpointName, new ServerSocket(endpointName));

  // Only one client per service
  if (!clients.has(serviceName))
    if (serviceName === 'game')
      clients.set(serviceName, new GameClient(
        sockets.get(endpointName),
        clients.get('auth'),
      ));
    else if (serviceName === 'chat')
      clients.set(serviceName, new ChatClient(
        sockets.get(endpointName),
        clients.get('auth'),
      ));
    else if (serviceName === 'push')
      clients.set(serviceName, new PushClient(
        sockets.get(endpointName),
        clients.get('auth'),
      ));
    else
      throw new TypeError('No such service');

  return clients.get(serviceName);
};

let terminating = false;

window.addEventListener('pagehide', event => {
  terminating = !event.persisted;
});
document.addEventListener('visibilitychange', event => {
  if (document.hidden) {
    // When possible, detect if document is hidden while closing or navigating
    // away from the page (terminating).  This allows the server to receive the
    // right WebSocket termination code (CLOSE_GOING_AWAY) when this is true.
    if (terminating) return;
    sockets.forEach(s => s.close(CLOSE_INACTIVE));
  }
  else {
    terminating = false;
    sockets.forEach(s => s.open());
  }
});
