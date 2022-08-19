import 'components/Modal/Progress.scss';

import Modal from 'components/Modal.js';

const template = `
  <SPAN class="message"></SPAN>
  <DIV class="bar">
    <DIV class="percent"></DIV>
  </DIV>
`;

export default class Progress extends Modal {
  constructor(options = {}) {
    options.closeOnCancel = false;
    options.content = template;

    super(options);

    this.root.classList.add('progress');

    Object.assign(this, {
      whenComplete: new Promise(),
    });
  }

  enableButtonMode(cb) {
    this._els.content.classList.add('buttonMode');
    this._els.content.addEventListener('click', cb);
  }
  disableButtonMode(cb) {
    this._els.content.classList.remove('buttonMode');
    this._els.content.removeEventListener('click', cb);
  }

  set percent(percent) {
    let whenComplete = this.whenComplete;

    this._els.content.querySelector('.percent').style.width = Math.floor(percent * 100)+'px';

    if (percent === 1 && !whenComplete.isResolved) {
      this._emit({ type:'complete' });

      this.whenComplete.resolve();
    } else if (whenComplete.isResolved) {
      this.whenComplete = new Promise();
    }
  }
  set message(message) {
    this._els.content.querySelector('.message').textContent = message;
  }
};
