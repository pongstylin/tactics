import '@babel/polyfill'
import React from 'react'
import { render } from 'react-dom'
import AppContainer from './containers/AppContainer'

render(<AppContainer/>, document.querySelector('#root-app'));
