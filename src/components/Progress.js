import emitter from 'utils/emitter.js';
import './Progress.scss';

const template = `
  <SPAN class="message"></SPAN>
  <DIV class="bar">
    <DIV class="percent"></DIV>
  </DIV>
`;

export default class Progress {
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
      root,
      whenComplete: new Promise(),
    });
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

    this.root.querySelector('.percent').style.width = Math.floor(percent * 100)+'px';

    if (percent === 1 && !whenComplete.isResolved) {
      this._emit({ type:'complete' });

      this.whenComplete.resolve();
    }
    else if (whenComplete.isResolved) {
      this.whenComplete = new Promise();
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
};

emitter(Progress);
