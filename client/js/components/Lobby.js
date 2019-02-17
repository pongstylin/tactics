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
    gameID: '',
    showGameIDInput: false,
  };

  joinGameClicked = () => {
    this.setState({ showGameIDInput: true })
  };

  handleChange = event => {
    this.setState({ gameID: event.target.value });
  };

  handleSubmit = event => {
    event.preventDefault();
    this.props.handleJoinGame(this.state.gameID);
  };

  render () {
    return (
      <GameContext.Provider value={this.getContext()}>
        <div className="Lobby">
          {this.state.showGameIDInput ? (
            <React.Fragment>
              <form className="GameIDForm" onSubmit={this.handleSubmit} autoComplete="off">
                <div className="GameIDForm__field">
                  <label htmlFor="message">{'Game ID'}</label>
                  <input
                    type="text"
                    name="gameID"
                    id="gameID"
                    autoComplete="off"
                    value={this.state.message}
                    onChange={this.handleChange}
                  />
                </div>
                <div className="Lobby__buttons">
                  <button onClick={() => this.setState({ showGameIDInput: false })}>{'Cancel'}</button>
                  <button onClick={this.handleSubmit}>{'Join!'}</button>
                </div>
              </form>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div className="Lobby__GameToolbar">
                <div className="Lobby__buttons">
                  <button onClick={this.props.handleCreateGame}>{'Create Game'}</button>
                  <button onClick={this.joinGameClicked}>{'Join Game'}</button>
                </div>
              </div>
              <div className="Lobby__chat">
                <MessageContainer/>
              </div>
              <div className="Lobby__occupancy">
                <OccupancyContainer/>
              </div>
            </React.Fragment>
          )}
        </div>
      </GameContext.Provider>
    );
  }
}
