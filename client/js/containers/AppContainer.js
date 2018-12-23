import React, { Component } from 'react'
import { BrowserRouter } from 'react-router-dom'
import socket from '../core/socket';
import App from '../components/App'

export default class AppContainer extends Component {
  componentDidMount() {
    socket.connect();
    socket.on('connected', () => {
      console.info('connected');
    });
    socket.on('disconnected', () => {
      console.info('disconnected');
    });
  }

  render () {
    return (
      <BrowserRouter>
        <App/>
      </BrowserRouter>
    );
  }
}
