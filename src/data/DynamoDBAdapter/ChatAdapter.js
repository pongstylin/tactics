import DynamoDBAdapter from '#data/DynamoDBAdapter.js';

export default class extends DynamoDBAdapter {
  constructor() {
    super({
      name: 'chat',
      fileTypes: new Map([
        [
          'room', {
            saver: '_saveRoom',
          },
        ],
      ]),
    });
  }

  /*****************************************************************************
   * Public Interface
   ****************************************************************************/
  async createRoom(room) {
    await this._createRoom(room);
    this.cache.get('room').add(room.id, room);
  }
  async openRoom(roomId) {
    const room = await this._getRoom(roomId);
    return this.cache.get('room').open(roomId, room);
  }
  closeRoom(roomId) {
    return this.cache.get('room').close(roomId);
  }
  async getRoom(roomId) {
    const room = await this._getRoom(roomId);
    return this.cache.get('room').add(roomId, room);
  }

  /*****************************************************************************
   * Private Interface
   ****************************************************************************/
  async _createRoom(room) {
    if (this.cache.get('room').has(room.id) || this.buffer.get('room').has(room.id))
      throw new Error('Room already exists');

    this.buffer.get('room').add(room.id, room);
  }
  async _getRoom(roomId) {
    if (this.cache.get('room').has(roomId))
      return this.cache.get('room').get(roomId);
    else if (this.buffer.get('room').has(roomId))
      return this.buffer.get('room').get(roomId);

    const room = await this.getItem({
      id: roomId,
      type: 'room',
      name: `room_${roomId}`,
    });
    room.once('change', () => this.buffer.get('room').add(roomId, room));

    return room;
  }
  async _saveRoom(room) {
    room.once('change', () => this.buffer.get('room').add(room.id, room));

    await this.putItem({
      id: room.id,
      type: 'room',
      name: `room_${room.id}`,
      data: room,
    });
  }
};
