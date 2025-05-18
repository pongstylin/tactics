import FileAdapter from '#data/FileAdapter.js';
import serializer from '#utils/serializer.js';

export default class extends FileAdapter {
  constructor() {
    super({
      name: 'push',
    });
  }

  async getAllPushSubscriptions(playerId) {
    const pushData = await this._getPlayerPushSubscriptions(playerId);

    return new Map([ ...pushData.subscriptions ]);
  }
  async hasAnyPushSubscription(playerId) {
    const pushData = await this._getPlayerPushSubscriptions(playerId);

    return pushData.subscriptions.size > 0;
  }
  async getPushSubscription(playerId, deviceId) {
    const pushData = await this._getPlayerPushSubscriptions(playerId);

    return pushData.subscriptions.get(deviceId);
  }
  async setPushSubscription(playerId, deviceId, subscription) {
    const pushData = await this._getPlayerPushSubscriptions(playerId);

    if (subscription)
      pushData.subscriptions.set(deviceId, subscription);
    else
      pushData.subscriptions.delete(deviceId);

    await this._savePlayerPushSubscriptions(playerId, pushData);
  }

  async _getPlayerPushSubscriptions(playerId) {
    const fileName = `player_${playerId}_push`;
    return await this.getFile(fileName, data => {
      if (data === undefined)
        return { playerId, subscriptions:new Map() };

      return serializer.normalize(migrate('playerPush', data, { playerId }));
    });
  }
  async _savePlayerPushSubscriptions(playerId, pushData) {
    const fileName = `player_${playerId}_push`;
    await this.putFile(fileName, serializer.transform(pushData));
  }
};
