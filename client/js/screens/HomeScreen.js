import React, { Component } from 'react'
import Screen from '../components/Screen'
import { Link } from 'react-router-dom'

export default class HomeScreen extends Component {
  render () {
    return (
      <Screen name="home">
        <h1>Home Screen</h1>
        <Link to="/play">Play Now</Link>
      </Screen>
    );
  }
}
