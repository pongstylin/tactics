import React, { Component, createRef } from 'react'
import PropTypes from 'prop-types'
import socket from '../core/socket'
import config from '../config'
import validator from '../../../shared/validator/index'

export default class Auth extends Component {
  static propTypes = {
    onLogin: PropTypes.func,
  };

  static AUTH_TYPES = {
    QUICK_PLAY: 'quickPlay',
    LOGIN: 'login',
    REGISTER: 'register',
    DEFAULT: 'quickPlay',
  };

  username = createRef();

  state = {
    type: null,
    data: {
      username: '',
      password: '',
      passwordConfirm: '',
    },
    submitting: false,
    errors: [],
  };

  componentDidMount () {
    const jwtKey = 'jwt/accessToken';
    socket.on('auth.succeeded', async player => {
      await this.setState({submitting: false});
      localStorage.setItem(jwtKey, player.token);
      this.props.onLogin && this.props.onLogin(player);
    });
    socket.on('auth.failed', errors => {
      this.setState({submitting: false, errors});
    });

    const token = localStorage.getItem(jwtKey);
    if (token) {
      this.setState({ type: 'usingExistingSession' });
      this.loginWithJWT(token);
    } else {
      this.setState({ type: Auth.AUTH_TYPES.DEFAULT });
    }
  }

  loginWithJWT = (token, attempts=0) => {
    if (attempts > 3) {
      console.error('Failed max attempts for logging in with existing token');
      this.setState({ type: Auth.AUTH_TYPES.DEFAULT });
      return;
    }

    if (!socket.emit('loginJWT', { token })) {
      setTimeout(() => this.loginWithJWT(token, attempts + 1), 400);
    }
  };


  toggleType = async () => {
    let newType;

    switch(this.state.type) {
      case Auth.AUTH_TYPES.LOGIN: {
        newType = Auth.AUTH_TYPES.REGISTER;
        break;
      }
      case Auth.AUTH_TYPES.REGISTER: {
        newType = Auth.AUTH_TYPES.LOGIN;
        break;
      }
      case Auth.AUTH_TYPES.QUICK_PLAY: {
        newType = Auth.AUTH_TYPES.LOGIN;
        break;
      }
      default: {
        newType = Auth.AUTH_TYPES.LOGIN;
      }
    }

    await this.setState({
      type: newType,
      errors: [],
    });
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
    if (this.state.type === 'usingExistingSession') {
      return (
        <p>Logging you in...</p>
      )
    }

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

        <div className={`AuthType_${this.state.type}`}>
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

          {this.state.type !== Auth.AUTH_TYPES.QUICK_PLAY && (
            <div className="Auth__field">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                name="password"
                autoComplete={this.state.type === Auth.AUTH_TYPES.LOGIN ? 'current-password' : 'new-password'}
                id="password"
                onChange={this.handleChange}
                value={this.state.data.password}
              />
            </div>
          )}

          {this.state.type === Auth.AUTH_TYPES.REGISTER && (
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

          {this.state.type === Auth.AUTH_TYPES.QUICK_PLAY ? (
            <div className="Auth__buttons">
              <button type="button" onClick={this.toggleType}>{'Existing Account'}</button>
              <button type="submit">{'Play!'}</button>
            </div>
          ) : (
            <div className="Auth__buttons">
              <button type="button" onClick={this.toggleType}>
                {this.state.type === Auth.AUTH_TYPES.LOGIN ? 'New Account' : 'Back'}
              </button>
              <button type="submit">{this.state.type === Auth.AUTH_TYPES.LOGIN ? 'Login' : 'Register'}</button>
            </div>
          )}
        </div>
      </form>
    );
  }
}
