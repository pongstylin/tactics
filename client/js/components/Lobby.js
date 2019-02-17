import React, { Component } from 'react'
import PropTypes from 'prop-types'

import GameContext from './game/context/GameContext'
import MessageContainer from '../containers/MessageContainer'
import OccupancyContainer from '../containers/OccupancyContainer'

export default class Lobby extends Component {
  static propTypes = {
    handleCreateGame: PropTypes.func.isRequired,
    handleJoinGame: PropTypes.func.isRequired,
    player: PropTypes.object.isRequired,
  };

  getContext () {
    return {
      player: this.props.player,
    };
  }

  state = {

  };


  render () {
    return (
      <GameContext.Provider value={this.getContext()}>
        <div className="Lobby">
          <div className="Lobby__GameToolbar">
            <div className="Lobby__buttons">
              <button onClick={this.props.handleCreateGame}>{'Create Game'}</button>
            </div>
          </div>
          <div className="Lobby__chat">
            <MessageContainer/>
          </div>
          <div className="Lobby__occupancy">
            <OccupancyContainer/>
          </div>
        </div>
      </GameContext.Provider>
    );
  }
}
