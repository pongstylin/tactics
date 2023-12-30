import FileAdapter from '#data/FileAdapter.js';
import migrate, { getLatestVersionNumber } from '#data/migrate.js';
import serializer from '#utils/serializer.js';

import Room from '#models/Room.js';

export default class extends FileAdapter {
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
    await this.createFile(`room_${room.id}`, () => {
      const data = serializer.transform(room);
      data.version = getLatestVersionNumber('room');

      room.once('change', () => this.buffer.get('room').add(room.id, room));
      return data;
    });
  }
  async _getRoom(roomId) {
    if (this.cache.get('room').has(roomId))
      return this.cache.get('room').get(roomId);
    else if (this.buffer.get('room').has(roomId))
      return this.buffer.get('room').get(roomId);

    return this.getFile(`room_${roomId}`, data => {
      const room = serializer.normalize(migrate('room', data));

      room.once('change', () => this.buffer.get('room').add(roomId, room));
      return room;
    });
  }
  async _saveRoom(room) {
    await this.putFile(`room_${room.id}`, room, () => {
      const data = serializer.transform(room);
      data.version = getLatestVersionNumber('room');

      room.once('change', () => this.buffer.get('room').add(room.id, room));
      return data;
    });
  }
};
