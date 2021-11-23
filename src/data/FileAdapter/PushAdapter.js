import FileAdapter from 'data/FileAdapter.js';

export default class extends FileAdapter {
  constructor() {
    super({
      name: 'push',
    });
  }

  async getAllPushSubscriptions(playerId) {
    const fileName = `player_${playerId}_push`;
    return await this.getFile(fileName, {
      subscriptions: [],
    }, pushData => new Map(pushData.subscriptions));
  }
  async hasPushSubscription(playerId) {
    const subscriptions = await this.getAllPushSubscriptions(playerId);

    return subscriptions.size > 0;
  }
  async getPushSubscription(playerId, deviceId) {
    const subscriptions = await this.getAllPushSubscriptions(playerId);

    return subscriptions.get(deviceId);
  }
  async setPushSubscription(playerId, deviceId, subscription) {
    const fileName = `player_${playerId}_push`;

    const pushData = await this.getFile(fileName, {
      subscriptions: [],
    }, pushData => {
      pushData.subscriptions = new Map(pushData.subscriptions);
      return pushData;
    });
    if (subscription)
      pushData.subscriptions.set(deviceId, subscription);
    else
      pushData.subscriptions.delete(deviceId);

    await this.putFile(fileName, pushData);
  }
};
