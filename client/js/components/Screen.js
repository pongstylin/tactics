import React, { Component } from 'react'
import PropTypes from 'prop-types'

export default class Screen extends Component {
  static propTypes = {
    name: PropTypes.string.isRequired,
  };

  componentDidCatch () {
    // TODO: Handle screen errors.
  }

  render () {
    return (
      <div className={`Screen Screen--${this.props.name}`}>
        {this.props.children}
      </div>
    );
  }
}
