import jwt from 'jsonwebtoken';
import webpush from 'web-push';

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

  async pushNotification(playerId, notification) {
    let subscriptions = await dataAdapter.getAllPushSubscriptions(playerId);
    if (subscriptions.size === 0) return Promise.resolve([]);

    this.debug(`${notification.type}: playerId=${playerId}; subscriptions=${subscriptions.size}`);

    let payload = JSON.stringify(notification);

    webpush.setVapidDetails(
      config.push.subject,
      config.push.publicKey,
      config.push.privateKey,
    );

    return Promise.all([...subscriptions].map(([deviceId, subscription]) =>
      webpush.sendNotification(subscription, payload).catch(error => {
        // push subscription has unsubscribed or expired.
        if (error.statusCode === 410)
          dataAdapter.setPushSubscription(playerId, deviceId, null);

        this.debug(`${notification.type}: playerId=${playerId}; deviceId=${deviceId}; error=[${error.statusCode}] ${error.body}`);
      })
    ));
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
