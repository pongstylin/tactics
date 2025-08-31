import AccessToken from '#server/AccessToken.js';
import Service from '#server/Service.js';
import ServerError from '#server/Error.js';
import Room from '#models/Room.js';

export default class ChatService extends Service {
  constructor(props) {
    super({
      ...props,

      clientPara: new Map(),
      roomPara: new Map(),
      playerPara: new Map(),
    });

    this.setValidation({
      authorize: { token:AccessToken },
      events: {
        message: [ 'chat:group', 'string' ],
        seen: [ 'chat:group', 'integer(0)' ],
      },
      definitions: {
        group: 'string(/^\\/rooms\\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/)',
      },
    });

    this._onACLChangeListener = this._onACLChange.bind(this);
  }

  /*
   * Test if the service will handle the message from client
   */
  will(client, messageType, body) {
    super.will(client, messageType, body);
    if (messageType === 'authorize')
      return;

    // Authorization required
    const clientPara = this.clientPara.get(client.id);
    if (!clientPara)
      throw new ServerError(401, 'Authorization is required');
    if (clientPara.token.isExpired)
      throw new ServerError(401, 'Token is expired');
  }

  async createRoom(players, options) {
    const room = Room.create(players, options);

    await this.data.createRoom(room);

    return room;
  }

  dropClient(client) {
    const clientPara = this.clientPara.get(client.id);
    if (!clientPara) return;

    this.clientPara.delete(client.id);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  onAuthorize(client, { token }) {
    if (this.clientPara.has(client.id)) {
      const clientPara = this.clientPara.get(client.id);
      if (clientPara.playerId !== token.playerId)
        throw new ServerError(501, 'Unsupported change of player');

      clientPara.name = token.playerName;
      clientPara.token = token;
    } else {
      const clientPara = {
        roomIds: new Set(),
      };

      const playerId = clientPara.playerId = token.playerId;
      clientPara.name = token.playerName;
      clientPara.token = token;
      this.clientPara.set(client.id, clientPara);
    }
  }

  async onJoinGroup(client, groupPath, params) {
    if (groupPath.startsWith('/rooms/'))
      return this.onJoinRoomGroup(client, groupPath, groupPath.slice(7), params);
    else
      throw new ServerError(404, 'No such group');
  }
  onLeaveGroup(client, groupPath) {
    if (groupPath.startsWith('/rooms/'))
      return this.onLeaveRoomGroup(client, groupPath, groupPath.slice(7));
    else
      throw new ServerError(404, 'No such group');
  }

  /*
   * Only room participants can join the room group.  Right now, players cannot
   * become of a participant of an existing room.  However, when a game starts,
   * a room is created with the game participants.
   */
  async onJoinRoomGroup(client, groupPath, roomId, resume) {
    const room = await this.data.openRoom(roomId);
    // Abort if the client is no longer connected.
    if (client.closed) {
      this.data.closeRoom(roomId);
      return;
    }

    const clientPara = this.clientPara.get(client.id);
    const member = room.players.find(p => p.id === clientPara.playerId);
    if (!member)
      throw new ServerError(403, 'You are not a participant of this room');

    /*
     * Get the players now to avoid 'firstJoined' triggering more than once.
     */
    const memberIds = room.players.map(p => p.id);
    const players = await Promise.all(memberIds.map(id => this.auth.openPlayer(id)));
    // Abort if the client is no longer connected.
    if (client.closed) {
      this.data.closeRoom(roomId);
      return;
    }

    const firstJoined = !this.roomPara.has(roomId);
    if (firstJoined) {
      const emit = async event => {
        // Forward muted events to clients.
        this._emit({
          type: 'event',
          body: {
            group: groupPath,
            type: event.type,
            data: event.data,
          },
        });
      };

      const roomPara = {
        room,
        muted: new Map(
          players.map(p => [ p.id, new Set(p.hasMutedOrBlocked(players, room.applyRules)) ]),
        ),
        clientIds: new Set(),
        emit,
      };
      this.roomPara.set(roomId, roomPara);

      for (const player of players) {
        if (this.playerPara.has(player.id))
          this.playerPara.get(player.id).roomIds.add(roomId);
        else {
          player.on('acl', this._onACLChangeListener);
          this.playerPara.set(player.id, {
            roomIds: new Set([ roomId ]),
          });
        }
      }
    }

    clientPara.roomIds.add(roomId);

    const roomPara = this.roomPara.get(roomId);
    roomPara.clientIds.add(client.id);

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id:   member.id,
          name: member.name,
        },
      },
    });

    let events = room.events;
    if (resume)
      events = events.filter(m => m.id > resume.id);

    return {
      players: room.players
        .map(({id, name, lastSeenEventId}) => ({id, name, lastSeenEventId})),
      muted: roomPara.muted,
      events,
    };
  }

  /*
   * No longer send message events to the client about this room.
   */
  onLeaveRoomGroup(client, groupPath, roomId) {
    const room = this.data.closeRoom(roomId);
    const memberIds = room.players.map(p => p.id);

    const clientPara = this.clientPara.get(client.id);
    clientPara.roomIds.delete(roomId);

    const roomPara = this.roomPara.get(roomId);
    const players = memberIds.map(id => this.auth.closePlayer(id));
    if (roomPara.clientIds.size > 1)
      roomPara.clientIds.delete(client.id);
    else {
      for (const player of players) {
        const playerPara = this.playerPara.get(player.id);
        if (playerPara.roomIds.size > 1)
          playerPara.roomIds.delete(roomId);
        else {
          player.off('acl', this._onACLChangeListener);
          this.playerPara.delete(player.id);
        }
      }

      this.roomPara.delete(roomId);
    }

    const member = room.players.find(p => p.id === clientPara.playerId);

    this._emit({
      type: 'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id: member.id,
          name: member.name,
        },
      },
    });
  }

  async onMessageEvent(client, groupPath, messageContent) {
    const roomId = groupPath.replace('/rooms/', '');
    const room = await this.data.getRoom(roomId);
    const playerId = this.clientPara.get(client.id).playerId;
    const player = room.players.find(p => p.id === playerId);

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

    const message = {
      player: player,
      content: messageContent,
    };

    room.pushMessage(message);

    const roomPara = this.roomPara.get(roomId);
    roomPara.emit({
      type: 'message',
      data: message,
    });
  }
  async onSeenEvent(client, groupPath, eventId) {
    const roomId = groupPath.replace('/rooms/', '');
    const room = await this.data.getRoom(roomId);
    const playerId = this.clientPara.get(client.id).playerId;
    const player = room.players.find(p => p.id === playerId);

    room.seenEvent(playerId, eventId);

    const roomPara = this.roomPara.get(roomId);
    roomPara.emit({
      type: 'seen',
      data: { player, eventId },
    });
  }

  async _onACLChange({ target }) {
    const playerPara = this.playerPara.get(target.id);

    for (const roomId of playerPara.roomIds) {
      const roomPara = this.roomPara.get(roomId);
      const room = roomPara.room;
      const memberIds = room.players.map(p => p.id);
      const players = await Promise.all(memberIds.map(id => this.auth.getPlayer(id)));

      for (const player of players) {
        const oldMuted = [ ...roomPara.muted.get(player.id) ];
        const newMuted = player.hasMutedOrBlocked(players, room.applyRules);
        if (oldMuted.join(',') === newMuted.join(','))
          continue;

        roomPara.muted.set(player.id, newMuted);
        roomPara.emit({
          type: 'muted',
          data: {
            playerId: player.id,
            muted: newMuted,
          },
        });
      }
    }
  }
}
