const RECONNECT_TIMEOUT = 1000;
const URI = 'ws://localhost:8080';

const executeEventFunctions = (events, event, data = null) => {
  if (events.hasOwnProperty(event)) {
    for (let i = events[event].length - 1; i >= 0; i--) {
      events[event][i].call(null, data);
    }
  }
};

const state = {
  events: {},
  connection: null,
  connected: false,
};

export default {
  connect () {
    state.connection = new WebSocket(URI);
    state.connection.onopen = () => {
      state.connected = true;
    };
    state.connection.onmessage = message => {
      const {event, data} = JSON.parse(message.data);
      executeEventFunctions(state.events, event, data);
    };
    state.connection.onclose = () => {
      state.connected = false;
      setTimeout(this.connect, RECONNECT_TIMEOUT);
      executeEventFunctions(state.events, 'disconnected');
    };
  },
  disconnect () {
    if (state.connected) {
      state.connection.onclose = () => {};
      state.connection.close();
      state.connected = false;
    }
  },
  on (event, func) {
    if (!state.events.hasOwnProperty(event)) {
      state.events[event] = [];
    }
    state.events[event].push(func);
  },
  emit (event, data = null) {
    if (state.connected) {
      state.connection.send(JSON.stringify({event, data}));
    }
  },
  off (event, func) {
    if (state.events.hasOwnProperty(event)) {
      for (let i = state.events[event].length - 1; i >= 0; i--) {
        if (state.events[event][i] === func) {
          state.events = state.events.splice(i, 1);
        }
      }
    }
  },
}
