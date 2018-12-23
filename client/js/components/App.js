import React, { Component } from 'react'
import { Route, Switch } from 'react-router-dom'
import HomeScreen from '../screens/HomeScreen'
import PlayScreen from '../screens/PlayScreen'

export default class App extends Component {
  render () {
    return (
      <Switch>
        <Route exact path="/" component={HomeScreen}/>
        <Route exact path="/play" component={PlayScreen}/>
      </Switch>
    );
  }
}
