import React, { Component } from 'react'
import PropTypes from 'prop-types'

import GameContext from './context/GameContext'
import MessageContainer from '../../containers/MessageContainer'
import OccupancyContainer from '../../containers/OccupancyContainer'
import socket from '../../core/socket'
import SubmitActions from './SubmitActions'

export default class Game extends Component {
  static propTypes = {
    id: PropTypes.string.isRequired,
    player: PropTypes.object.isRequired,
  };

  componentDidMount() {
    socket.on('performActions', data => {
      this.handleActions(data.actions);
    })
  }

  handleActions(actions) {
    console.log('Handling actions!', actions);
  }

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
          <div className="Game__chat">
            <SubmitActions/>
            <MessageContainer/>
          </div>
          <div className="Game__occupancy">
            <OccupancyContainer/>
          </div>
        </div>
      </GameContext.Provider>
    );
  }
}
