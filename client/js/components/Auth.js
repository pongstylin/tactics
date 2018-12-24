import React, { Component, createRef } from 'react'
import PropTypes from 'prop-types'
import socket from '../core/socket'
import config from '../config'
import validator from '../../../shared/validator/index'

export default class Auth extends Component {
  static propTypes = {
    onLogin: PropTypes.func,
  };

  username = createRef();

  state = {
    type: 'login',
    data: {
      username: '',
      password: '',
      passwordConfirm: '',
    },
    submitting: false,
    errors: [],
  };

  componentDidMount () {
    socket.on('auth.succeeded', async player => {
      await this.setState({submitting: false});
      this.props.onLogin && this.props.onLogin(player);
    });
    socket.on('auth.failed', errors => {
      this.setState({submitting: false, errors});
    });
  }

  toggleType = async () => {
    await this.setState({type: this.state.type === 'login' ? 'register' : 'login', errors: []});
    this.username.current.focus();
  };

  handleSubmit = event => {
    event.preventDefault();

    // Prevent simultaneous submits
    if (this.state.submitting) {
      return;
    }
    this.setState({submitting: true, errors: []});

    const validation = validator.validate(this.state.data, config.shared.validators[this.state.type](this.state.data));

    if (!validation.passed) {
      this.setState({submitting: false, errors: validation.getErrors()});
      return;
    }

    socket.emit(this.state.type, this.state.data);
  };

  handleChange = event => {
    const {data} = this.state;
    data[event.target.name] = event.target.value;
    this.setState({data});
  };

  render () {
    return (
      <form onSubmit={this.handleSubmit} className="Auth">
        {this.state.errors.length > 0 && (
          <div className="Auth__errors">
            {this.state.errors.map((error, index) => (
              <div key={index} className="Auth__errors-error">
                {error}
              </div>
            ))}
          </div>
        )}

        <div className="Auth__field">
          <label htmlFor="username">Name</label>
          <input
            type="text"
            name="username"
            autoComplete="username"
            autoFocus={true}
            id="username"
            ref={this.username}
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
              name="passwordConfirm"
              autoComplete="new-password"
              id="passwordConfirm"
              onChange={this.handleChange}
              value={this.state.data.passwordConfirm}
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
    );
  }
}
