import config from 'config/server.js';

/*
 * This is a list of services that need to be used by other services.
 *
 * The game service needs the chat and push services.
 * The chat service needs the push service.
 *
 * The auth and game services are only used by clients, right now.
 */
import ChatService from 'server/ChatService.js';
import PushService from 'server/PushService.js';

let endpoints = config.endpoints;

export default serviceName => {
  let endpoint = endpoints.get(serviceName);

  // TODO: Create proxy class to communicate with remote endpoints.
  if (endpoint !== 'local')
    throw new Error('Remote endpoints are not supported');

  if (serviceName === 'chat')
    return ChatService;
  else if (serviceName === 'push')
    return PushService;

  throw new Error(`Unexpected service name: ${serviceName}`);
};
