import DynamoDBAdapter from '#data/DynamoDBAdapter.js';

export default class extends DynamoDBAdapter {
  constructor() {
    super({
      name: 'push',
      fileTypes: new Map([
        [
          'playerPush', {
            saver: '_savePlayerPushSubscriptions',
          },
        ],
      ]),
    });
  }

  async getAllPushSubscriptions(playerId) {
    const pushData = await this._getPlayerPushSubscriptions(playerId);
    this.cache.get('playerPush').add(playerId, pushData);

    return new Map([ ...pushData.subscriptions ]);
  }
  async hasAnyPushSubscription(playerId) {
    const pushData = await this._getPlayerPushSubscriptions(playerId);
    this.cache.get('playerPush').add(playerId, pushData);

    return pushData.subscriptions.size > 0;
  }
  async getPushSubscription(playerId, deviceId) {
    const pushData = await this._getPlayerPushSubscriptions(playerId);
    this.cache.get('playerPush').add(playerId, pushData);

    return pushData.subscriptions.get(deviceId);
  }
  async setPushSubscription(playerId, deviceId, subscription) {
    const pushData = await this._getPlayerPushSubscriptions(playerId);
    this.cache.get('playerPush').add(playerId, pushData);

    const oldSubscription = pushData.subscriptions.get(deviceId) ?? null;
    if (JSON.stringify(oldSubscription) === JSON.stringify(subscription))
      return;

    if (subscription)
      pushData.subscriptions.set(deviceId, subscription);
    else
      pushData.subscriptions.delete(deviceId);

    if (!this.buffer.get('playerPush').has(playerId))
      this.buffer.get('playerPush').add(playerId, pushData);
  }

  async _getPlayerPushSubscriptions(playerId) {
    if (this.cache.get('playerPush').has(playerId))
      return this.cache.get('playerPush').get(playerId);
    else if (this.buffer.get('playerPush').has(playerId))
      return this.buffer.get('playerPush').get(playerId);

    const playerPush = await this.getItem({
      id: playerId,
      type: 'playerPush',
      name: `player_${playerId}_push`,
    }, { playerId }, {
      playerId,
      subscriptions: new Map(),
    });

    return playerPush;
  }
  async _savePlayerPushSubscriptions(playerPush) {
    await this.putItem({
      id: playerPush.playerId,
      type: 'playerPush',
      data: playerPush,
    });
  }
};
