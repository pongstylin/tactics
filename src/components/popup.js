import 'components/popup.scss';

class Popup {
  constructor(options) {
    Object.assign(this, {
      el: null,
      options: null,
      whenClosed: new Promise((resolve, reject) => {
        this._resolveClosed = resolve;
        this._rejectClosed = reject;
      }),

      _openTimeout: null,
    });
    this.setOptions(options);

    if (this.options.autoOpen === true)
      this.open();
    else if (typeof this.options.autoOpen === 'number')
      this._openTimeout = setTimeout(() => this.open(), this.options.autoOpen);
  }

  setOptions(options) {
    if (typeof options === 'string')
      options = { message:options };
    if (options.buttons)
      options.buttons = options.buttons.map(b => Object.assign({
        closeOnClick: true,
        closeOnError: true,
        showError: false,
      }, b));

    this.options = Object.assign({
      container: document.body,
      title: null,
      autoOpen: true,
      autoShow: true,
      closeOnCancel: true,
      buttons: [{
        label: 'Ok',
        closeOnClick: true,
        closeOnError: true,
        showError: false,
      }],
    }, options);
  }

  render() {
    let options = this.options;

    let divOverlay = document.createElement('DIV');
    divOverlay.classList.add('overlay');
    if (options.zIndex)
      divOverlay.style.zIndex = options.zIndex;
    divOverlay.addEventListener('click', event => {
      // Ignore clicks that bubbled from the popup.
      if (event.target !== divOverlay) return;
      if (options.closeOnCancel === false) return;

      let value;
      if (options.onCancel)
        value = options.onCancel();

      this.close({
        value: value,
        cancelled: true,
      });
    });

    let divPopup = document.createElement('DIV');
    divPopup.classList.add('popup');
    if (options.minWidth)
      divPopup.style.minWidth = options.minWidth;
    divOverlay.appendChild(divPopup);

    if (options.title) {
      let divTitle = document.createElement('DIV');
      divTitle.classList.add('title');
      divTitle.textContent = options.title;
      divPopup.appendChild(divTitle);
    }

    let divMessage = document.createElement('DIV');
    divMessage.classList.add('message');
    divMessage.textContent = options.message;
    divPopup.appendChild(divMessage);

    let divButtons = document.createElement('DIV');
    divButtons.classList.add('buttons');
    divButtons.setAttribute('autocomplete', 'off');
    divPopup.appendChild(divButtons);

    options.buttons.forEach(button => {
      let btn = document.createElement('BUTTON');
      btn.setAttribute('type', 'button');
      if ('name' in button)
        btn.setAttribute('name', button.name);
      btn.textContent = button.label;
      btn.addEventListener('click', async event => {
        let closeEvent = { button };

        if (button.onClick) {
          let waitingPopup;

          try {
            let value = button.onClick(event, button);
            if (value instanceof Promise) {
              this.hide();

              waitingPopup = new Popup({
                message: 'Please wait...',
                closeOnCancel: false,
                buttons: [],
              });
              closeEvent.value = await value;
              waitingPopup.close();

              if (!button.closeOnClick)
                this.show();
            }
            else
              closeEvent.value = value;
          }
          catch (error) {
            if (waitingPopup)
              waitingPopup.close();

            closeEvent.error = error;

            if (button.showError)
              new Popup({
                title: 'Error',
                message: error.message,
              });

            if (button.closeOnError)
              this.close(closeEvent);

            return;
          }
        }

        if (button.closeOnClick)
          this.close(closeEvent);
      });
      divButtons.appendChild(btn);
    });

    return divOverlay;
  }

  open() {
    if (this.isOpen)
      throw new TypeError('Already open');

    this.el = this.render();

    let options = this.options;
    if (options.before) {
      let sibling = typeof options.before === 'string'
        ? document.querySelector(options.before)
        : options.before;
      let container = sibling.parentNode;

      container.insertBefore(this.el, sibling);
    }
    else {
      let container = typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container;

      container.appendChild(this.el);
    }

    if (this.options.autoShow === true)
      this.show();
  }

  update(options) {
    if (!this.isOpen)
      throw new TypeError('Not open');

    this.setOptions(options);

    let newEl = this.render();
    let oldEl = this.el;
    oldEl.parentNode.replaceChild(this.el = newEl, oldEl);
  }

  hide() {
    this.el.classList.remove('show');
  }
  show() {
    this.el.classList.add('show');
  }
  close(event) {
    event = Object.assign({
      cancelled: false,
      value: undefined,
      button: null,
    }, event, {
      type: 'close',
      target: this,
    });

    // Popup was closed before it even opened?
    clearTimeout(this._openTimeout);

    if (!this.isOpen) return;

    if (this.options.onClose)
      this.options.onClose(event);
    if (event.error)
      this._rejectClosed(event.error);
    else
      this._resolveClosed(event.value);

    this.el.remove();
    this.el = null;
  }

  get isOpen() {
    return !!this.el;
  }
}

export default options => new Popup(options);
