import 'components/popup.scss';

import Overlay from 'components/overlay.js';

class Popup {
  constructor(options) {
    Object.assign(this, {
      root: null,
      overlay: null,
      options: null,
      whenClosed: new Promise(),

      _openTimeout: null,
    });
    this.setOptions(options);

    if (this.options.autoOpen === true)
      this.open();
    else if (typeof this.options.autoOpen === 'number')
      this._openTimeout = setTimeout(() => this.open(), this.options.autoOpen);
  }

  get isVisible() {
    return this.overlay.isVisible;
  }

  setOptions(options) {
    if (typeof options === 'string')
      options = { message:options };
    else if (options.buttons)
      options.buttons = options.buttons.map(button => {
        if (typeof button === 'string')
          button = { label:button };

        return Object.assign({
          closeOnClick: true,
          closeOnError: true,
          showError: false,
          value: button.label,
        }, button);
      });

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
    const options = this.options;

    const overlay = new Overlay({
      zIndex: options.zIndex ?? 200,
    }).on('click', event => {
      if (options.closeOnCancel === false) return;

      let value;
      if (options.onCancel)
        value = options.onCancel();

      this.close({
        value: value,
        cancelled: true,
      });
    });

    const divPopup = this.root = document.createElement('DIV');
    divPopup.classList.add('popup');
    if (options.className)
      divPopup.classList.add(options.className);
    if (options.minWidth)
      divPopup.style.minWidth = options.minWidth;
    if (options.maxWidth)
      divPopup.style.maxWidth = options.maxWidth;
    if (options.margin)
      divPopup.style.margin = options.margin;
    overlay.root.appendChild(divPopup);

    if (options.title) {
      const divTitle = document.createElement('DIV');
      divTitle.classList.add('title');
      divTitle.innerHTML = options.title;
      divPopup.appendChild(divTitle);
    }

    if (options.message !== undefined) {
      const divMessage = document.createElement('DIV');
      divMessage.classList.add('message');
      if (typeof options.message === 'string')
        divMessage.innerHTML = options.message;
      else {
        const elements = Array.isArray(options.message) ? options.message : [ options.message ];
        for (const el of elements) {
          if (typeof el === 'string')
            divMessage.appendChild(document.createTextNode(el));
          else
            divMessage.appendChild(el);
        }
      }
      divPopup.appendChild(divMessage);
    }

    const divButtons = document.createElement('DIV');
    divButtons.classList.add('buttons');
    divButtons.setAttribute('autocomplete', 'off');
    divPopup.appendChild(divButtons);

    options.buttons.forEach(button => {
      const btn = document.createElement('BUTTON');
      btn.setAttribute('type', 'button');
      if ('name' in button)
        btn.setAttribute('name', button.name);
      btn.innerHTML = button.label;
      btn.addEventListener('click', async event => {
        const closeEvent = { button };

        if (button.onClick) {
          let waitingPopup;

          try {
            const value = button.onClick(event, button);
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
            } else
              closeEvent.value = value;
          } catch (error) {
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

    return overlay;
  }

  open() {
    if (this.isOpen)
      throw new TypeError('Already open');

    this.overlay = this.render();

    const options = this.options;
    if (options.before) {
      const sibling = typeof options.before === 'string'
        ? document.querySelector(options.before)
        : options.before;
      const container = sibling.parentNode;

      container.insertBefore(this.overlay.root, sibling);
    }
    else {
      const container = typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container;

      container.appendChild(this.overlay.root);
    }

    if (this.options.autoShow === true)
      this.show();
  }

  update(options) {
    if (!this.isOpen)
      throw new TypeError('Not open');

    this.setOptions(options);

    const isVisible = this.isVisible;
    const oldEl = this.overlay.root;
    const newEl = (this.overlay = this.render()).root;

    oldEl.parentNode.replaceChild(newEl, oldEl);

    if (isVisible)
      this.show();
  }

  hide() {
    this.overlay.hide();
  }
  show() {
    this.overlay.show();
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
      this.whenClosed.reject(event.error);
    else if (event.value !== undefined)
      this.whenClosed.resolve(event.value);
    else if (event.button)
      this.whenClosed.resolve(event.button.value);
    else
      this.whenClosed.resolve();

    this.overlay.root.remove();
    this.overlay = null;
  }

  get isOpen() {
    return !!this.overlay;
  }
}

export default options => new Popup(options);
