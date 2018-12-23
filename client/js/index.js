import '@babel/polyfill'
import React from 'react'
import { render } from 'react-dom'
import AppContainer from './containers/AppContainer'

render(<AppContainer/>, document.querySelector('#root-app'));

// import socket from './core/socket';

// socket.connect();
//
// socket.on('connected', () => {
//   console.log('connected');
// });
//
// socket.on('registered', data => {
//   console.log('registered', data);
// });
//
// socket.on('disconnected', () => {
//   console.log('disconnected');
// });
//
// const register = document.querySelector('#register');
// register && register.addEventListener('submit', event => {
//   event.preventDefault();
//
//   const fields = register.querySelectorAll('input');
//   const data = {};
//
//   for (let i = 0; i < fields.length; i++) {
//     data[fields[i].name] = fields[i].value;
//   }
//
//   socket.emit('register', data);
// });
