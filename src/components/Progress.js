import EventEmitter from 'events';

import './progress.scss';

const template = `
  <SPAN class="message">Loading...</SPAN>
  <DIV class="bar">
    <DIV class="percent"></DIV>
  </DIV>
`;

class Progress {
  constructor() {
    let root = document.getElementById('progress');
    if (!root) {
      root = document.createElement('DIV');
      root.id = 'progress';
      root.style.display = 'none';
      root.innerHTML = template;

      document.body.appendChild(root);
    }

    Object.assign(this, {
      root:     root,
      _emitter: new EventEmitter(),
    });
  }

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
  }

  enableButtonMode(cb) {
    this.root.classList.add('buttonMode');
    this.root.addEventListener('click', cb);
  }
  disableButtonMode(cb) {
    this.root.classList.remove('buttonMode');
    this.root.removeEventListener('click', cb);
  }

  set percent(percent) {
    this.root.querySelector('.percent').style.width = percent+'px';

    if (percent === 100)
      this._emit({ type:'complete' });
  }
  set message(message) {
    this.root.querySelector('.message').textContent = message;
  }

  show() {
    this.root.style.display = '';
  }
  hide() {
    this.root.style.display = 'none';
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}

export default Progress;
