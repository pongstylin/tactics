import 'components/Modal.scss';

export default class Modal {
  constructor(options, data) {
    Object.assign(this, {
      el: null,
      options: null,
      data,
      whenClosed: new Promise((resolve, reject) => {
        this._resolveClosed = resolve;
        this._rejectClosed = reject;
      }),
    });
    if (options)
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
      closeOnCancel: true,
      hideOnCancel: false,
    }, options);
  }

  makeTitle() {
    const divTitle = document.createElement('DIV');
    divTitle.classList.add('title');
    divTitle.innerHTML = this.options.title;
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

    const divModal = document.createElement('DIV');
    divModal.classList.add('modal');
    divOverlay.appendChild(divModal);

    if (options.title)
      divModal.appendChild(this.makeTitle());

    const divContent = document.createElement('DIV');
    divContent.classList.add('content');
    divContent.innerHTML = options.content;
    divModal.appendChild(divContent);

    return divOverlay;
  }
  renderTitle(title = null) {
    if (this.options.title !== null && title !== null) {
      this.options.title = title;
      this.el.querySelector('.modal > .title').innerHTML = title;
    } else if (this.options.title !== null && title === null) {
      this.options.title = title;
      this.el.querySelector('.modal > .title').remove();
    } else if (this.options.title === null && title !== null) {
      this.options.title = title;
      this.el.querySelector('.modal').prepend(this.makeTitle());
    }
  }
  renderContent(content) {
    this.options.content = content;
    this.el.querySelector('.modal > .content').innerHTML = content;
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

    this.destroy();
  }

  destroy() {
    this.el.remove();
    this.el = null;
  }
}
