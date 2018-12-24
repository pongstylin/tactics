import React, { Component } from 'react'
import PropTypes from 'prop-types'

export default class Auth extends Component {
  static propTypes = {
    player: PropTypes.object,
  };

  render () {
    return (
      <div className="Game" style={{color: '#fff'}}>
        <p>Game</p>
        <p>
          Player:<br/>
          {JSON.stringify(this.props.player)}
        </p>
      </div>
    );
  }
}
