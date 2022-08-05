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
    if (this.options.title === title && this._els.title)
      return;

    if (this._els.title === null)
      this._els.modal.insertBefore(this._els.title = this.makeTitle(title), this._els.content);
    else
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
    }, options);
  }

  makeTitle(title) {
    const divTitle = document.createElement('DIV');
    divTitle.classList.add('title');
    divTitle.innerHTML = title;
    return divTitle;
  }

  render() {
    const options = this.options;

    const divOverlay = document.createElement('DIV');
    divOverlay.classList.add('overlay');
    if (options.zIndex)
      divOverlay.style.zIndex = options.zIndex;
    divOverlay.addEventListener('click', event => {
      // Ignore clicks that bubbled from the popup.
      if (event.target !== divOverlay) return;

      if (options.hideOnCancel)
        this.hide();
      else if (options.closeOnCancel)
        this.close();
    });
    this._els.root = divOverlay;

    const divModal = document.createElement('DIV');
    divModal.classList.add('modal');
    divOverlay.appendChild(divModal);
    this._els.modal = divModal;

    const divContent = document.createElement('DIV');
    divContent.classList.add('content');
    divContent.innerHTML = options.content;
    divModal.appendChild(divContent);
    this._els.content = divContent;

    if (options.title !== undefined && options.title !== null)
      this.title = options.title;

    trapFocus(divOverlay);

    return divOverlay;
  }
  renderContent(content) {
    this.options.content = content;
    this.el.querySelector('.modal > .content').innerHTML = content;
  }

  open() {
    if (this.isOpen)
      throw new TypeError('Already open');

    this._els.root = this.render();
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
    this._els.root.classList.add('show');
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

  destroy() {
    this._els.root.remove();
    this._els.root = null;
  }
}

emitter(Modal);
