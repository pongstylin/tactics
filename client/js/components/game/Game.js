import React, { Component } from 'react'
import PropTypes from 'prop-types'
import GameContext from './context/GameContext'
import MessageContainer from '../../containers/MessageContainer'

export default class Game extends Component {
  static propTypes = {
    id: PropTypes.string.isRequired,
    player: PropTypes.object.isRequired,
  };

  state = {
    //
  };

  getContext () {
    return {
      gameId: this.props.id,
      player: this.props.player,
    };
  }

  render () {
    return (
      <GameContext.Provider value={this.getContext()}>
        <div className="Game">
          <MessageContainer/>
        </div>
      </GameContext.Provider>
    );
  }
}
