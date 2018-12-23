import React, { Component } from 'react'
import PropTypes from 'prop-types'
import socket from '../core/socket'
import config from '../config'
import validator from '../../../shared/validator/index'

export default class Auth extends Component {
  static propTypes = {
    onLogin: PropTypes.func,
  };

  state = {
    type: 'login',
    data: {
      username: '',
      password: '',
      password_confirmed: '',
    },
    submitting: false,
    errors: [],
  };

  componentDidMount () {
    socket.on('registered', player => {
      if (this.props.onLogin) {
        this.props.onLogin(player);
      }
    });
  }

  toggleType = () => {
    this.setState({type: this.state.type === 'login' ? 'register' : 'login'});
  };

  handleSubmit = async event => {
    event.preventDefault();

    // Prevent simultaneous submits
    if (this.state.submitting) {
      return;
    }
    this.setState({submitting: true});

    // TODO: Validate data
    const validation = validator.validate(this.state.data, config.shared.validators[this.state.type](this.state.data));

    if (!validation.passed) {
      this.setState({submitting: false, errors: validation.getErrors()});
      return;
    }

    socket.emit('register', this.state.data);
  };

  handleChange = event => {
    const {data} = this.state;
    data[event.target.name] = event.target.value;
    this.setState({data});
  };

  render () {
    return (
      <div className="Auth">
        <form onSubmit={this.handleSubmit}>
          <div className="Auth__field">
            <label htmlFor="username">Name</label>
            <input
              type="text"
              name="username"
              autoComplete="username"
              id="username"
              onChange={this.handleChange}
              value={this.state.data.username}
            />
          </div>

          <div className="Auth__field">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              name="password"
              autoComplete={this.state.type === 'login' ? 'current-password' : 'new-password'}
              id="password"
              onChange={this.handleChange}
              value={this.state.data.password}
            />
          </div>

          {this.state.type === 'register' && (
            <div className="Auth__field">
              <label htmlFor="password_confirmed">Confirm Password</label>
              <input
                type="password"
                name="password_confirmed"
                autoComplete="new-password"
                id="password_confirmed"
                onChange={this.handleChange}
                value={this.state.data.password_confirmed}
              />
            </div>
          )}

          <div className="Auth__buttons">
            <button type="button" onClick={this.toggleType}>
              {this.state.type === 'login' ? 'New Account' : 'Back'}
            </button>
            <button type="submit">{this.state.type === 'login' ? 'Login' : 'Register'}</button>
          </div>
        </form>
      </div>
    );
  }
}
