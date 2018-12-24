import React, { Component, createRef } from 'react'
import socket from '../../../core/socket'

export default class MessageList extends Component {
  state = {
    messages: [],
  };

  messages = createRef();

  componentDidMount () {
    socket.on('message.received', this.handleReceivedMessage);
  }

  componentWillUnmount() {
    socket.off('message.received', this.handleReceivedMessage);
  }

  handleReceivedMessage = async message => {
    await this.setState({messages: this.state.messages.concat(message)});
    this.scrollToBottom();
  }

  scrollToBottom() {
    this.messages.current.scrollTop = this.messages.current.scrollHeight - this.messages.current.clientHeight;
  }

  render () {
    return (
      <div className="MessageList" ref={this.messages}>
        {this.state.messages.map((message, index) => (
          <div key={index} className="MessageList__message">
            <em>{message.player.username}</em>: {message.message}
          </div>
        ))}
      </div>
    );
  }
}
