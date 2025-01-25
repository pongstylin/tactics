import 'components/Modal.scss';
import Overlay from 'components/overlay.js';
import trapFocus from 'components/trapFocus.js';
import whenDOMReady from 'components/whenDOMReady.js';
import emitter from 'utils/emitter.js';

export default class Modal {
  constructor(options, data = {}) {
    Object.assign(this, {
      options: null,
      data,
      whenHidden: null,
      whenClosed: null,
      isCancelled: false,

      _overlay: null,
      _els: {
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

  get root() {
    return this._els.modal;
  }

  get isOpen() {
    return !!this._overlay;
  }
  get isVisible() {
    return this.isOpen && this._overlay.isVisible;
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

    const overlay = this._overlay = new Overlay({
      zIndex: options.zIndex ?? 100,
    }).on('click', event => this._emitCancel(overlay.root));

    const divModal = this._els.modal = document.createElement('DIV');
    divModal.classList.add('modal');
    divModal.tabIndex = -1;
    divModal.addEventListener('click', event => {
      // Clicking a cancel button triggers a cancel
      const btnCancel = event.target.closest('BUTTON[name=cancel]');
      if (btnCancel)
        this._emitCancel(btnCancel);
    });
    overlay.root.appendChild(divModal);

    if (options.withHeader) {
      const header = this._els.header = this.renderHeader();
      divModal.appendChild(header);

      this._els.title = header.querySelector('.title');
    }

    const divContent = this._els.content = document.createElement('DIV');
    divContent.classList.add('content');
    if (options.content === undefined)
      divContent.innerHTML = '';
    else if (typeof options.content === 'string')
      divContent.innerHTML = options.content;
    else
      divContent.appendChild(options.content);
    divModal.appendChild(divContent);

    return overlay.root;
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
    if (typeof content === 'string')
      this._els.content.innerHTML = content;
    else {
      this._els.content.innerHTML = '';
      this._els.content.appendChild(content);
    }

    return this._els.content;
  }

  open() {
    if (this.isOpen)
      throw new TypeError('Already open');

    this.render();
    if (this.options.appendTo) {
      this.options.appendTo.appendChild(this._overlay.root);
      this._emit({ type:'attach' });
    } else
      whenDOMReady.then(() => {
        document.body.appendChild(this._overlay.root);
        this._emit({ type:'attach' });
      });

    if (this.options.autoShow === true)
      this.show();

    this.whenClosed = new Promise();
    return this.whenClosed;
  }

  hide() {
    if (this.whenHidden === null) return;

    this._overlay.hide();
    this.whenHidden.resolve(this);
    this.whenHidden = null;
  }
  show(onShow) {
    this.isCancelled = false;
    trapFocus(this._els.modal);
    this._overlay.show();
    this._els.modal.focus();
    if (onShow) onShow();
    if (!this.whenHidden) this.whenHidden = new Promise();
    return this.whenHidden;
  }
  close() {
    if (!this.isOpen) return;

    this.hide();

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

    this.isCancelled = true;
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
    this._overlay.root.remove();
    this._overlay = null;
  }
}

emitter(Modal);
