import React, { Component } from 'react'
import PropTypes from 'prop-types'
import GameContext from './context/GameContext'
import MessageList from './message/MessageList'
import MessageBox from './message/MessageBox'

export default class Auth extends Component {
  static propTypes = {
    player: PropTypes.object,
  };

  state = {
    //
  };

  getContext () {
    return {
      player: this.props.player,
    };
  }

  render () {
    return (
      <GameContext.Provider value={this.getContext()}>
        <div className="Game">
          <MessageBox/>
          <MessageList/>
        </div>
      </GameContext.Provider>
    );
  }
}
