import React, { Component } from 'react'
import socket from '../../../core/socket'
import GameContextConsumer from '../context/GameContextConsumer'

@GameContextConsumer
export default class MessageBox extends Component {
  state = {
    message: '',
  };

  handleSubmit = event => {
    event.preventDefault();

    if (this.state.message.trim().length === 0) {
      return;
    }

    socket.emit('message', {message: this.state.message, player: this.props.context.player});
    this.setState({message: ''});
  };

  handleChange = event => {
    this.setState({[event.target.name]: event.target.value});
  };

  render () {
    return (
      <form className="MessageBox" onSubmit={this.handleSubmit} autoComplete="off">
        <div className="MessageBox__field">
          <label htmlFor="message">Message (Press Enter to send)</label>
          <input
            type="text"
            name="message"
            id="message"
            autoComplete="off"
            value={this.state.message}
            onChange={this.handleChange}
          />
        </div>
      </form>
    );
  }
}
