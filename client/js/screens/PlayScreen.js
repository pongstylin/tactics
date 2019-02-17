import React, { Component } from 'react'
import Screen from '../components/Screen'
import Auth from '../components/Auth'
import Lobby from '../components/Lobby'
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

  handleLogin = async player => {
    console.log(player);

    const gameId = this.props.match.params.gameId || null;

    await this.setState({ player, gameId });
    if (gameId) {
      socket.emit('joinGame', { gameId });
    } else {
      socket.emit('joinRoom', { room: 'Lobby' });
    }
  };

  handleCreateGame = () => {
    socket.emit('createGame');
  };

  handleJoinGame = async gameId => {
    await this.setState({ gameId });
    socket.emit('joinGame', { gameId });
  };


  render () {
    const isLoggedIn = this.state.player !== null;
    const showLobby = isLoggedIn && this.state.gameId === null;
    const showGame = isLoggedIn  && this.state.gameId !== null;

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
        {!isLoggedIn && <Auth onLogin={this.handleLogin}/>}
        {showLobby && (
          <Lobby
            handleCreateGame={this.handleCreateGame}
            handleJoinGame={this.handleJoinGame}
            player={this.state.player}
          />
        )}
        {showGame && <Game player={this.state.player} id={this.state.gameId}/>}
      </Screen>
    );
  }
}
