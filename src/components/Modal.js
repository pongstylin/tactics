import 'components/Modal.scss';

export default class Modal {
  constructor(options) {
    Object.assign(this, {
      el: null,
      options: null,
      whenClosed: new Promise((resolve, reject) => {
        this._resolveClosed = resolve;
        this._rejectClosed = reject;
      }),
    });
    this.setOptions(options);

    if (this.options.autoOpen === true)
      this.open();
  }

  get isOpen() {
    return !!this.el;
  }
  get isVisible() {
    return this.el.classList.contains('show');
  }

  setOptions(options) {
    if (typeof options === 'string')
      options = { content:options };

    this.options = Object.assign({
      title: null,
      autoOpen: true,
      autoShow: true,
      closeOnCancel: false,
      hideOnCancel: false,
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

      if (options.closeOnCancel)
        this.close();
      else if (options.hideOnCancel)
        this.hide();
    });

    let divModal = document.createElement('DIV');
    divModal.classList.add('modal');
    divOverlay.appendChild(divModal);

    if (options.title) {
      let divTitle = document.createElement('DIV');
      divTitle.classList.add('title');
      divTitle.textContent = options.title;
      divModal.appendChild(divTitle);
    }

    let divContent = document.createElement('DIV');
    divContent.classList.add('content');
    divContent.innerHTML = options.content;
    divModal.appendChild(divContent);

    return divOverlay;
  }

  open() {
    if (this.isOpen)
      throw new TypeError('Already open');

    this.el = this.render();
    document.body.appendChild(this.el);

    if (this.options.autoShow === true)
      this.show();
  }

  hide() {
    this.el.classList.remove('show');
  }
  show() {
    this.el.classList.add('show');
  }
  close() {
    if (!this.isOpen) return;

    if (this.options.onClose)
      this.options.onClose();
    this._resolveClosed();

    this.el.remove();
    this.el = null;
  }
}
