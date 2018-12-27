import React, { Component } from 'react'
import MessageBox from '../components/game/message/MessageBox'
import MessageList from '../components/game/message/MessageList'

export default class MessageContainer extends Component {
  render () {
    return (
      <div className="MessageContainer">
        <MessageBox/>
        <MessageList/>
      </div>
    );
  }
}
