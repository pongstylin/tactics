import 'components/Modal.scss';
import whenDOMReady from 'components/whenDOMReady.js';
import trapFocus from 'components/trapFocus.js';
import emitter from 'utils/emitter.js';

export default class Modal {
  constructor(options, data = {}) {
    Object.assign(this, {
      options: null,
      data,
      whenHidden: null,
      whenClosed: null,

      _els: {
        root: null,
        modal: null,
        title: null,
        content: null,
      },
    });
    if (options)
      this.setOptions(options);

    if (this.options.autoOpen === true)
      this.open();
  }

  get el() {
    return this._els.root;
  }
  get isOpen() {
    return !!this._els.root;
  }
  get isVisible() {
    return this._els.root.classList.contains('show');
  }

  get title() {
    return this.options.title;
  }
  set title(title = null) {
    if (this.options.title === title)
      return;

    if (this._els.title)
      this._els.title.innerHTML = title;

    this.options.title = title;
  }

  setOptions(options) {
    if (typeof options === 'string')
      options = { content:options };

    this.options = Object.assign({
      title: null,
      autoOpen: true,
      autoShow: true,
      closeOnCancel: true,
      hideOnCancel: false,
      withHeader: options.title !== undefined && options.title !== null,
    }, options);
  }

  render() {
    const options = this.options;

    const divOverlay = document.createElement('DIV');
    divOverlay.classList.add('overlay');
    if (options.zIndex)
      divOverlay.style.zIndex = options.zIndex;
    divOverlay.addEventListener('click', event => {
      // Clicking outside the popup triggers a cancel
      if (event.target === divOverlay)
        return this._emitCancel(divOverlay);

      // Clicking a cancel button triggers a cancel
      const btnCancel = event.target.closest('BUTTON[name=cancel]');
      if (btnCancel)
        this._emitCancel(btnCancel);
    });
    this._els.root = divOverlay;

    const divModal = document.createElement('DIV');
    divModal.classList.add('modal');
    divModal.tabIndex = -1;
    divOverlay.appendChild(divModal);
    this._els.modal = divModal;

    if (options.withHeader) {
      const header = this.renderHeader();
      divModal.appendChild(header);
      this._els.header = header;
      this._els.title = header.querySelector('.title');
    }

    const divContent = document.createElement('DIV');
    divContent.classList.add('content');
    divContent.innerHTML = options.content;
    divModal.appendChild(divContent);
    this._els.content = divContent;

    return divOverlay;
  }
  renderHeader() {
    const header = document.createElement('HEADER');

    const divTitle = document.createElement('DIV');
    divTitle.classList.add('title');
    divTitle.innerHTML = this.options.title ?? '&nbsp;';
    header.appendChild(divTitle);

    const divButtons = document.createElement('DIV');
    divButtons.classList.add('buttons');
    header.appendChild(divButtons);

    const btnCancel = document.createElement('BUTTON');
    btnCancel.classList.add('fa');
    btnCancel.classList.add('fa-xmark');
    btnCancel.name = 'cancel';
    btnCancel.title = 'Close';
    divButtons.appendChild(btnCancel);

    return header;
  }
  renderContent(content) {
    this.options.content = content;
    this.el.querySelector('.modal > .content').innerHTML = content;
  }

  open() {
    if (this.isOpen)
      throw new TypeError('Already open');

    this.render();
    if (this.options.appendTo) {
      this.options.appendTo.appendChild(this.el);
      this._emit({ type:'attach' });
    } else
      whenDOMReady.then(() => {
        document.body.appendChild(this.el)
        this._emit({ type:'attach' });
      });

    if (this.options.autoShow === true)
      this.show();

    this.whenClosed = new Promise();
    return this.whenClosed;
  }

  hide() {
    this._els.root.classList.remove('show');
    this.whenHidden.resolve(this);
    this.whenHidden = null;
  }
  show(onShow) {
    trapFocus(this._els.root);
    this._els.root.classList.add('show');
    this._els.modal.focus();
    if (onShow) onShow();
    this.whenHidden = new Promise();
    return this.whenHidden;
  }
  close() {
    if (!this.isOpen) return;

    if (this.options.onClose)
      this.options.onClose();
    this.whenClosed.resolve(this);
    this.whenClosed = null;

    this.destroy();
  }

  _emitCancel(target) {
    const options = this.options;
    let doDefault = true;
    const preventDefault = () => doDefault = false;

    this._emit({
      type: 'cancel',
      target,
      preventDefault,
    });

    if (doDefault) {
      if (options.hideOnCancel)
        this.hide();
      else if (options.closeOnCancel)
        this.close();
    }
  }

  destroy() {
    this._els.root.remove();
    this._els.root = null;
  }
}

emitter(Modal);
