import React, { Component, createRef } from 'react'
import socket from '../../core/socket'

export default class MessageList extends Component {
  state = {
    occupants: [],
  };

  componentDidMount () {
    socket.on('roomOccupantsChanged', this.handleOccupantsChange);
  }

  componentWillUnmount() {
    socket.off('roomOccupantsChanged', this.handleOccupantsChange);
  }

  handleOccupantsChange = async data => {
    await this.setState({ occupants: data.occupants });
  };

  render () {
    return (
      <div className="OccupancyList">
        {this.state.occupants.map((occupant, index) => (
          <div key={index} className={`OccupancyList__Occupant`}>
            {occupant}
          </div>
        ))}
      </div>
    );
  }
}
