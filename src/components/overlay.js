import 'components/overlay.scss';
import emitter from 'utils/emitter.js';

class Overlay {
  constructor(options) {
    Object.assign(this, {
      _root: null,
      options: null,

      _openTimeout: null,
    });
    this.setOptions(options);

    this._root = this.render();
  }

  get root() {
    return this._root;
  }

  get isVisible() {
    return this._root.classList.contains('show');
  }

  setOptions(options) {
    this.options = Object.assign({
      autoShow: true,
      zIndex: null,
    }, options);
  }

  render() {
    const options = this.options;
    const divOverlay = document.createElement('DIV');
    divOverlay.classList.add('overlay');

    if (options.zIndex)
      divOverlay.style.zIndex = options.zIndex;
    divOverlay.addEventListener('click', event => {
      // Do not react to clicks that bubble from descendents
      if (event.target === divOverlay)
        this._emit(event);
    });

    return divOverlay;
  }

  show() {
    this._root.classList.add('show');
  }
  hide() {
    this._root.classList.remove('show');
  }
}

emitter(Overlay);

export default Overlay;
