import webpush from 'web-push';

import AccessToken from '#server/AccessToken.js';
import Service from '#server/Service.js';
import ServerError from '#server/Error.js';

export default class PushService extends Service {
  constructor(props) {
    super({
      ...props,

      // Session data for each client.
      sessions: new Map(),
    });

    this.setValidation({
      authorize: { token:AccessToken },
      requests: {
        setSubscription: [ 'any' ],
      },
    });
  }

  initialize() {
    this.auth.on('player:removeDevice', ({ data:{ player, deviceId } }) =>
      this.clearPushSubscription(player.id, deviceId)
    );

    return super.initialize();
  }

  hasPushSubscription(playerId) {
    return this.data.hasPushSubscription(playerId);
  }
  async pushNotification(playerId, notification, urgency = 'normal') {
    const subscriptions = await this.data.getAllPushSubscriptions(playerId);
    if (subscriptions.size === 0) return;

    this.debug(`${notification.type}: playerId=${playerId}; subscriptions=${subscriptions.size}; urgency=${urgency}`);

    const payload = JSON.stringify(notification);

    webpush.setVapidDetails(
      this.config.subject,
      this.config.publicKey,
      this.config.privateKey,
    );

    return Promise.all([...subscriptions].map(([deviceId, subscription]) =>
      webpush.sendNotification(subscription, payload, {
        headers: {
          'Urgency': urgency,
        },
      }).catch(error => {
        // [403] invalid push subscription endpoint.
        // [410] push subscription has unsubscribed or expired.
        if (error.statusCode === 403 || error.statusCode === 410)
          this.data.setPushSubscription(playerId, deviceId, null);

        this.debug(`${notification.type}: playerId=${playerId}; deviceId=${deviceId}; error=[${error.statusCode}] ${error.body}`);
      })
    ));
  }

  clearPushSubscription(playerId, deviceId) {
    this.data.setPushSubscription(playerId, deviceId, null);
  }

  dropClient(client) {
    this.sessions.delete(client.id);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  onAuthorize(client, { token }) {
    this.sessions.set(client.id, {
      playerId: token.playerId,
      deviceId: token.deviceId,
    });
  }

  async onSetSubscriptionRequest(client, subscription) {
    let session = this.sessions.get(client.id);
    if (!session)
      throw new ServerError(401, 'Authorization is required');

    let playerId = session.playerId;
    let deviceId = session.deviceId;
    let oldSubscription = await this.data.getPushSubscription(playerId, deviceId);

    if (JSON.stringify(subscription) === JSON.stringify(oldSubscription))
      return;

    this.data.setPushSubscription(playerId, deviceId, subscription);

    this.debug(`setSubscription: playerId=${playerId}; deviceId=${deviceId}; subscription=${JSON.stringify(subscription)}`);
  }
}
