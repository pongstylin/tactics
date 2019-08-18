import jwt from 'jsonwebtoken';

import config from 'config/server.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import adapterFactory from 'data/adapterFactory.js';
import Room from 'models/Room.js';

const dataAdapter = adapterFactory();

class ChatService extends Service {
  constructor() {
    super({
      name: 'chat',

      clientPara: new Map(),
      roomPara: new Map(),
    });
  }

  /*
   * Test if the service will handle the message from client
   */
  will(client, messageType, bodyType) {
    // Authorization required
    let clientPara = this.clientPara.get(client.id);
    if (!clientPara)
      throw new ServerError(401, 'Authorization is required');
    if (clientPara.expires < (new Date() / 1000))
      throw new ServerError(401, 'Token is expired');
  }

  createRoom(players, options) {
    return dataAdapter.createRoom(players, options);
  }

  dropClient(client) {
    let clientPara = this.clientPara.get(client.id);
    if (!clientPara) return;

    if (clientPara.joinedGroups)
      clientPara.joinedGroups.forEach(room =>
        this.onLeaveGameGroup(client, `/rooms/${room.id}`, room.id)
      );

    this.clientPara.delete(client.id);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  onAuthorize(client, { token }) {
    if (!token)
      throw new ServerError(422, 'Required authorization token');

    let clientPara = this.clientPara.get(client.id) || {};
    let claims;
    
    try {
      claims = jwt.verify(token, config.publicKey);
    }
    catch (error) {
      throw new ServerError(401, error.message);
    }

    let playerId = clientPara.playerId = claims.sub;
    clientPara.name = claims.name;
    clientPara.expires = claims.exp;
    this.clientPara.set(client.id, clientPara);
  }

  async onJoinGroup(client, groupPath, params) {
    let match;
    if (match = groupPath.match(/^\/rooms\/(.+)$/))
      return this.onJoinRoomGroup(client, groupPath, match[1], params);
    else
      throw new ServerError(404, 'No such group');
  }

  /*
   * Only room participants can join the room group.  Right now, players cannot
   * become of a participant of an existing room.  However, when a game starts,
   * a room is created with the game participants.
   */
  async onJoinRoomGroup(client, groupPath, roomId, resume) {
    let clientPara = this.clientPara.get(client.id);
    let playerId = clientPara.playerId;
    let roomPara = this.roomPara.get(roomId);
    let room = roomPara ? roomPara.room : await this._getRoom(roomId);

    let player = room.players.find(p => p.id === playerId);
    if (!player)
      throw new ServerError(403, 'You are not a participant of this room');

    if (roomPara)
      roomPara.clients.add(clientPara);
    else
      this.roomPara.set(roomId, roomPara = {
        room:    room,
        clients: new Set([clientPara]),
      });

    if (clientPara.joinedGroups)
      clientPara.joinedGroups.set(room.id, room);
    else
      clientPara.joinedGroups = new Map([[room.id, room]]);

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id:   player.id,
          name: player.name,
        },
      },
    });

    let events = room.events;
    if (resume)
      events = events.filter(m => m.id > resume.id);

    return {
      players: room.players.map(({id, name}) => ({ id, name })),
      events: events,
    };
  }

  /*
   * No longer send message events to the client about this room.
   */
  async onLeaveGameGroup(client, groupPath, roomId) {
    let clientPara = this.clientPara.get(client.id);
    let playerId = clientPara.playerId;
    let room = roomId instanceof Room ? roomId : await this._getRoom(roomId);
    let player = room.players.find(p => p.id === playerId);

    // Already not watching?
    if (!clientPara.joinedGroups)
      return;
    if (!clientPara.joinedGroups.has(room.id))
      return;

    let roomPara = this.roomPara.get(room.id);
    if (roomPara.clients.size > 1)
      roomPara.clients.delete(clientPara);
    else {
      this.roomPara.delete(room.id);

      // Save the room before it is wiped from memory.
      dataAdapter.saveRoom(roomPara.room);
    }

    if (clientPara.joinedGroups.size === 1)
      delete clientPara.joinedGroups;
    else
      clientPara.joinedGroups.delete(room.id);

    this._emit({
      type:   'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id:   player.id,
          name: player.name,
        },
      },
    });
  }

  onMessageEvent(client, groupPath, messageContent) {
    let roomId = groupPath.replace(/^\/rooms\//, '');
    let roomPara = this.roomPara.get(roomId);
    if (!roomPara)
      throw new ServerError(403, 'You have not joined the room group');

    let playerId = this.clientPara.get(client.id).playerId;
    let room = roomPara.room;

    let player = room.players.find(p => p.id === playerId);
    if (player === null)
      throw new ServerError(403, 'You are not a member of this room.');

    messageContent = messageContent.trim();

    if (messageContent.length === 0)
      throw new ServerError(400, 'Required message');
    if (messageContent.length > 140)
      throw new ServerError(403, 'The message is too long.');

    // Make the message HTML-safe.
    messageContent = messageContent
      .replace('&', '&amp;')
      .replace('<', '&lt;')
      .replace('>', '&gt;');

    let message = {
      player: player,
      content: messageContent,
    };

    dataAdapter.pushRoomMessage(room, message).then(() => {
      this._emit({
        type: 'event',
        body: {
          group: groupPath,
          type: 'message',
          data: message,
        },
      });
    });
  }

  /*******************************************************************************
   * Helpers
   ******************************************************************************/
  async _getRoom(roomId) {
    let room;
    if (this.roomPara.has(roomId))
      room = this.roomPara.get(roomId).room;
    else
      room = await dataAdapter.getRoom(roomId);

    return room;
  }
}

// This class is a singleton
export default new ChatService();
