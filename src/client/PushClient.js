import Client from 'client/Client.js';

export default class PushClient extends Client {
  constructor(server, authClient) {
    super('push', server);

    Object.assign(this, {
      _authClient: authClient,
    });

    authClient.on('token', ({data:token}) => this._authorize(token));

    // If the server connection is already open, fire the open event.
    // The open event is typically used to send authorization.
    if (server.isOpen && authClient.isAuthorized)
      this._authorize(authClient.token);
  }

  setSubscription(subscription) {
    return this._server
      .requestAuthorized(this.name, 'setSubscription', [subscription])
        .catch(error => {
          if (error === 'Connection reset')
            return this.setSubscription(subscription);

          throw error;
        });
  }

  _onOpen({ data }) {
    // Since a token is refreshed 1 minute before it expires and a connection
    // can only be resumed 30 seconds after disconnect, then authorization
    // should still be valid after resuming a connection.  Even if auth client
    // emits a new token while disconnected, authorization will be queued then
    // sent once the connection resumes without needing to handle it here.
    if (data.reason === 'resume') return;

    let authClient = this._authClient;

    // When the auth and push services share a server/connection, there is no
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
