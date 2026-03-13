import DynamoDBAdapter from '#data/DynamoDBAdapter.js';
import Room from '#models/Room.js';

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
    return this._createRoom(room);
  }
  async getRoom(roomId) {
    const room = await this._getRoom(roomId);
    return this.cache.get('room').add(roomId, room);
  }

  /*****************************************************************************
   * Private Interface
   ****************************************************************************/
  async _createRoom(room) {
    if (Room.cache.has(room.id))
      throw new Error('Room already exists');

    return Room.cache.use(room.id, () => {
      this.buffer.get('room').add(room.id, room);
      return room;
    });
  }
  async _getRoom(roomId) {
    return Room.cache.use(roomId, async () => {
      const room = await this.getItem({
        id: roomId,
        type: 'room',
        name: `room_${roomId}`,
      });
      room.once('change', () => this.buffer.get('room').add(roomId, room));

      return room;
    });
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
