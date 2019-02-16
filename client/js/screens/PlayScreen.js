import React, { Component } from 'react'
import Screen from '../components/Screen'
import Auth from '../components/Auth'
import Game from '../components/game/Game'
import socket from '../core/socket'

export default class PlayScreen extends Component {
  state = {
    player: null,
    gameId: null,
    errors: [],
  };

  componentDidMount() {
    socket.on('createGame.succeeded', gameId => {
      this.setState({ gameId, errors: [] });
      this.props.history.push(`/play/id/${gameId}`);
    });
    socket.on('createGame.failed', errors => {
      this.setState({ errors })
    });
    socket.on('joinGame.succeeded', gameId => {
      this.setState({ gameId, errors: [] })
    });
    socket.on('joinGame.failed', errors => {
      this.setState({ errors })
    })
  }

  handleLogin = player => {
    console.log(player);
    this.setState({player});

    const gameId = this.props.match.params.gameId;
    if (gameId) {
      socket.emit('joinGame', { gameId });
    } else {
      socket.emit('createGame');
    }
  };

  render () {
    return (
      <Screen name="play">
        {this.state.errors.length > 0 && (
          <div className="PlayScreen__errors">
            {this.state.errors.map((error, index) => (
              <div key={index} className="PlayScreen__errors-error">
                {error}
              </div>
            ))}
          </div>
        )}
        {this.state.player === null && <Auth onLogin={this.handleLogin}/>}
        {this.state.gameId !== null && <Game player={this.state.player} id={this.state.gameId}/>}
      </Screen>
    );
  }
}
