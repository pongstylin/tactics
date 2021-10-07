import ServerSocket, {
  CLOSE_INACTIVE,
  CLOSE_CLIENT_SHUTDOWN
} from 'client/ServerSocket.js';
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

let timeout = null;
let interval = null;

window.addEventListener('pagehide', event => {
  /*
   * Android Chrome Observations:
   *
   * If the page is terminating, then timeouts are not fired.  This means the
   * server is not sent the CLOSE_INACTIVE code.  This is good since it is more
   * accurate for the browser to send the CLOSE_GOING_AWAY code.
   *
   * But if the page is terminated using the back button (and there is no page
   * in the history to go back to) then the CLOSE_GOING_AWAY code is never sent.
   * The socket(s) simply disappear and the server has to wait for timeout...
   * sometimes.  Ugh, Chrome bugs.
   *
   * Fortunately, in the former case, the 'pagehide' event is fired BEFORE the
   * document is hidden.  But in the latter case, the 'pagehide' event is fired
   * AFTER the document is hidden.  So, to avoid socket timeout, shut down the
   * socket if document is already hidden to avoid occasional socket timeouts.
   */
  if (document.hidden)
    sockets.forEach(s => s.close(CLOSE_CLIENT_SHUTDOWN));
});
document.addEventListener('visibilitychange', event => {
  if (document.hidden) {
    // Give pending actions time to flush before closing the socket(s).
    // The timeout is never reached if the page is terminating.
    timeout = setTimeout(() => {
      sockets.forEach(s => s.close(CLOSE_INACTIVE));
    }, 2000);

    // Another Android Chrome bug.  If the screen is shut off for longer than 5
    // minutes than this event (and 'focus' event) are not fired when the screen
    // is turned back on.  So, timers to the rescue.
    interval = setInterval(() => {
      if (document.hidden) return;
      clearInterval(interval);
      clearTimeout(timeout);
      sockets.forEach(s => {
        if (s.closed === CLOSE_INACTIVE)
          s.open();
      });
    }, 1000);
  }
  else {
    clearTimeout(timeout);
    clearInterval(interval);
    sockets.forEach(s => {
      if (s.closed === CLOSE_INACTIVE)
        s.open();
    });
  }
});
