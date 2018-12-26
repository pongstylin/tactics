import React, { Component, createRef } from 'react'
import validator from '../../../../../shared/validator/index'
import config from '../../../config'
import socket from '../../../core/socket'
import GameContextConsumer from '../context/GameContextConsumer'

const MESSAGE_HISTORY_LIMIT = 10;
const HISTORY_PREV_KEY = 'ArrowUp';
const HISTORY_NEXT_KEY = 'ArrowDown';
const HISTORY_CLEAR_KEY = 'Escape';

@GameContextConsumer
export default class MessageBox extends Component {
  messageInput = createRef();

  state = {
    historyCursor: -1,
    history: [],
    message: '',
  };

  componentDidMount() {
    document.addEventListener('keydown', this.handleKeydown);
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.handleKeydown);
  }

  handleKeydown = async event => {
    let {historyCursor, history} = this.state;

    switch (event.key) {
      case HISTORY_PREV_KEY:
        historyCursor = Math.min(history.length - 1, historyCursor + 1);
        break;
      case HISTORY_NEXT_KEY:
        historyCursor = Math.max(-1, historyCursor - 1);
        break;
      case HISTORY_CLEAR_KEY:
        historyCursor = -1;
        break;
    }

    if ([HISTORY_PREV_KEY, HISTORY_NEXT_KEY, HISTORY_CLEAR_KEY].includes(event.key)) {
      let updatedMessage = historyCursor === -1 ? '' : history[historyCursor];
      updatedMessage = updatedMessage === undefined ? '' : updatedMessage;
      await this.setState({historyCursor, message: updatedMessage});
      const input = this.messageInput.current;

      // Move cursor to end of input
      requestAnimationFrame(() => {
        if (typeof input.selectionStart === 'number') {
          input.selectionStart = input.selectionEnd = input.value.length;
        } else if (typeof input === 'undefined') {
          const range = input.createRange();
          range.collapse(false);
          range.select();
        }
      });
    }
  };

  handleSubmit = async event => {
    event.preventDefault();

    if (!validator.validate({message: this.state.message}, {message: config.shared.validators.message}).passed) {
      return;
    }

    socket.emit('message', {message: this.state.message, player: this.props.context.player});

    await this.updateHistory();
    this.setState({message: '', historyCursor: -1});
  };

  updateHistory() {
    const {history} = this.state;
    if (history.length === MESSAGE_HISTORY_LIMIT) {
      history.splice(MESSAGE_HISTORY_LIMIT - 1, 1);
    }

    // Don't add duplicate messages to the history
    if (history[history.length - 1] === this.state.message) {
      return;
    }

    history.unshift(this.state.message);
    return this.setState({history});
  }

  handleChange = async event => {
    await this.setState({[event.target.name]: event.target.value});
  };

  render () {
    return (
      <form className="MessageBox" onSubmit={this.handleSubmit} autoComplete="off">
        <div className="MessageBox__field">
          <label htmlFor="message">Message (Press Enter to send)</label>
          <input
            ref={this.messageInput}
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
