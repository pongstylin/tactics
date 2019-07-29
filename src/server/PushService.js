import jwt from 'jsonwebtoken';

import config from 'config/server.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import adapterFactory from 'data/adapterFactory.js';

const dataAdapter = adapterFactory();

class PushService extends Service {
  constructor() {
    super({
      name: 'push',

      // Session data for each client.
      sessions: new Map(),
    });
  }

  dropClient(client) {
    this.sessions.delete(client.id);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  onAuthorize(client, { token }) {
    if (!token)
      throw new ServerError(422, 'Required authorization token');

    let claims;
    
    try {
      claims = jwt.verify(token, config.publicKey);
    }
    catch (error) {
      throw new ServerError(401, error.message);
    }

    if (!claims.deviceId)
      throw new ServerError(401, 'Required access token');

    this.sessions.set(client.id, {
      playerId: claims.sub,
      deviceId: claims.deviceId,
    });
  }

  onSetSubscriptionRequest(client, subscription) {
    let session = this.sessions.get(client.id);
    if (!session)
      throw new ServerError(401, 'Authorization is required');

    dataAdapter.setPushSubscription(
      session.playerId,
      session.deviceId,
      subscription,
    );
  }
}

// This class is a singleton
export default new PushService();
