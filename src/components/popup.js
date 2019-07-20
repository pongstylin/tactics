class Popup {
  constructor(options) {
    Object.assign(this, {
      el: null,
      options: null,
    });
    this.setOptions(options);

    if (this.options.open)
      this.open();
  }

  setOptions(options) {
    if (typeof options === 'string')
      options = { message:options };

    this.options = Object.assign({
      container: document.body,
      title: null,
      open: true,
      buttons: [{
        label: 'Ok',
      }],
    }, options);
  }

  render() {
    let options = this.options;

    let divOverlay = document.createElement('DIV');
    divOverlay.classList.add('overlay');
    divOverlay.addEventListener('click', event => {
      // Ignore clicks that bubbled from the popup.
      if (event.target !== divOverlay) return;

      let value;
      if (options.onCancel)
        value = options.onCancel();

      if (value !== false)
        this.close();
    });

    let divPopup = document.createElement('DIV');
    divPopup.classList.add('popup');
    if (options.minWidth)
      divPopup.style.minWidth = options.minWidth;
    divOverlay.append(divPopup);

    if (options.title) {
      let divTitle = document.createElement('DIV');
      divTitle.classList.add('title');
      divTitle.textContent = options.title;
      divPopup.append(divTitle);
    }

    let divMessage = document.createElement('DIV');
    divMessage.classList.add('message');
    divMessage.textContent = options.message;
    divPopup.append(divMessage);

    let divButtons = document.createElement('DIV');
    divButtons.classList.add('buttons');
    divButtons.setAttribute('autocomplete', 'off');
    divPopup.append(divButtons);

    options.buttons.forEach(button => {
      let btn = document.createElement('BUTTON');
      btn.setAttribute('type', 'button');
      if ('name' in button)
        btn.setAttribute('name', button.name);
      btn.textContent = button.label;
      btn.addEventListener('click', event => {
        if (button.onClick) {
          let value = button.onClick(event, button);
          if (value instanceof Promise) {
            let popup = new Popup({
              message: 'Please wait...',
              onCancel: () => false,
              buttons: [],
            });

            value
              .then(() => {
                popup.close();
                this.close();
              })
              .catch(error => popup.update(error.toString()));
          }
          else if (value !== false)
            this.close();
        }
        else
          this.close();
      });
      divButtons.append(btn);
    });

    return divOverlay;
  }

  open() {
    if (this.isOpen)
      throw new TypeError('Already open');

    let options = this.options;
    let container = typeof options.container === 'string'
      ? document.querySelector(options.container)
      : options.container;

    container.append(this.el = this.render());
  }

  update(options) {
    if (!this.isOpen)
      throw new TypeError('Not open');

    this.setOptions(options);

    let newEl = this.render();
    let oldEl = this.el;
    oldEl.parentNode.replaceChild(this.el = newEl, oldEl);
  }

  close() {
    // Silently fail.  Attempting to close a popup twice is normal.
    if (!this.isOpen) return;

    if (this.options.onClose)
      this.options.onClose();

    this.el.remove();
    this.el = null;
  }

  get isOpen() {
    return !!this.el;
  }
}

export default options => new Popup(options);
