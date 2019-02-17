import React, { Component, createRef } from 'react'

import config from '../../config'
import socket from '../../core/socket'
import validator from '../../../../shared/validator/index'

export default class SubmitActions extends Component {
  actions = createRef();

  state = {
    actions: '',
  };

  handleSubmit = async event => {
    event.preventDefault();

    let actionsObject;
    try {
      actionsObject = JSON.parse(this.state.actions);
    } catch (e) {
      console.error('Actions is not valid JSON');
      return;
    }

    const payload = { actions: actionsObject };
    const validation = validator.validate(payload, config.shared.validators.submitActions());
    if (!validation.passed) {
      console.error('submitActions validation failed', validation.getErrors());
      return;
    }

    socket.emit('submitActions', payload);
    return this.setState({actions: ''});
  };

  handleChange = async event => {
    await this.setState({[event.target.name]: event.target.value});
  };

  render () {
    return (
      <form className="MessageBox" onSubmit={this.handleSubmit} autoComplete="off">
        <div className="MessageBox__field">
          <label htmlFor="actions">Submit Actions</label>
          <input
            ref={this.actions}
            type="text"
            name="actions"
            id="actions"
            autoComplete="off"
            value={this.state.actions}
            onChange={this.handleChange}
          />
        </div>
      </form>
    );
  }
}
