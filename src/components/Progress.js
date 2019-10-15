import EventEmitter from 'events';

import './progress.scss';

const template = `
  <SPAN class="message">Loading...</SPAN>
  <DIV class="bar">
    <DIV class="percent"></DIV>
  </DIV>
`;

export default class {
  constructor() {
    let root = document.getElementById('progress');
    if (!root) {
      root = document.createElement('DIV');
      root.id = 'progress';
      root.className = 'view';
      root.innerHTML = template;

      document.body.appendChild(root);
    }

    Object.assign(this, {
      root:     root,
      whenComplete: new Promise(resolve => this._resolveComplete = resolve),

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
    let whenComplete = this.whenComplete;

    this.root.querySelector('.percent').style.width = percent+'px';

    if (percent === 100 && !whenComplete.isResolved) {
      this._emit({ type:'complete' });

      whenComplete.isResolved = true;
      this._resolveComplete();
    }
    else if (whenComplete.isResolved) {
      this.whenComplete = new Promise(resolve => this._resolveComplete = resolve);
    }
  }
  set message(message) {
    this.root.querySelector('.message').textContent = message;
  }

  show() {
    this.root.classList.add('show');
    return this;
  }
  hide() {
    this.root.classList.remove('show');
    return this;
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
