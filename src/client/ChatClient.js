import Client from 'client/Client.js';

export default class ChatClient extends Client {
  constructor(server, authClient) {
    super('chat', server);

    Object.assign(this, {
      _authClient: authClient,
    });

    authClient.on('token', ({data:token}) => this._authorize(token));

    let listener = event => {
      if (event.body.service !== this.name) return;

      if (event.body.type === 'muted')
        event.body.data.muted = new Set(event.body.data.muted);

      this._emit(event);
    };

    server
      .on('event', listener)
      .on('join',  listener)
      .on('leave', listener)
      .on('enter', listener)
      .on('exit',  listener);

    // If the server connection is already open, fire the open event.
    // The open event is typically used to send authorization.
    if (server.isOpen)
      this._emit({ type:'open', data:{ reason:'new' }});
  }

  joinChat(roomId, resume) {
    return this._server.joinAuthorized(this.name, `/rooms/${roomId}`, resume);
  }
  postMessage(roomId, message) {
    return this._server.emitAuthorized(this.name, `/rooms/${roomId}`, 'message', message);
  }
  seen(roomId, eventId) {
    return this._server.emitAuthorized(this.name, `/rooms/${roomId}`, 'seen', eventId);
  }

  _onOpen({ data }) {
    // Since a token is refreshed 1 minute before it expires and a connection
    // can only be resumed 30 seconds after disconnect, then authorization
    // should still be valid after resuming a connection.  Even if auth client
    // emits a new token while disconnected, authorization will be queued then
    // sent once the connection resumes without needing to handle it here.
    if (data.reason === 'resume') return;

    let authClient = this._authClient;

    // When the auth and chat services share a server/connection, there is no
    // need to get authorization from the auth client here.  This is because the
    // auth client refreshes a token every time a connection is opened and emits
    // the new token.  So, authorization will be sent upon token emit.
    if (this._server === authClient._server)
      return;

    // Only authorize if the auth client is already authorized.  If the auth
    // client is not authorized, then we'll catch the emitted token once it is.
    if (authClient.isAuthorized)
      this._authorize(authClient.token);
  }
}
