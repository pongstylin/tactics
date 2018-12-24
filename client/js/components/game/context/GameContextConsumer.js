import React from 'react'
import GameContext from './GameContext'

export default Component => props => (
  <GameContext.Consumer>
    {context => <Component {...props} context={context}/>}
  </GameContext.Consumer>
)
