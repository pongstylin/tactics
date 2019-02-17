import React, { Component } from 'react'
import OccupancyList from '../components/game/OccupancyList';

export default class OccupancyContainer extends Component {
  render () {
    return (
      <div className="OccupancyContainer">
        <OccupancyList/>
      </div>
    );
  }
}
