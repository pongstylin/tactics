import React, { Component } from 'react'
import Screen from '../components/Screen'
import Auth from '../components/Auth'
import Game from '../components/game/Game'

export default class PlayScreen extends Component {
  state = {
    player: null,
  };

  handleLogin = player => {
    this.setState({player});
    console.log(player);
  };

  render () {
    return (
      <Screen name="play">
        {this.state.player === null ? <Auth onLogin={this.handleLogin}/> : <Game player={this.state.player}/>}
      </Screen>
    );
  }
}
