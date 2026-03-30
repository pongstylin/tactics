import 'components/Spinner.scss';
import whenTransitionEnds from 'components/whenTransitionEnds.js';
import emitter from 'utils/emitter.js';

const template = `
  <DIV class="label">Please<br>wait...</DIV>
  <DIV class="wheel">
    <I class="fa fa-spinner fa-pulse"></I>
  </DIV>
`;

export default class Spinner {
  constructor(options = {}) {
    options.content = template;

    Object.assign(this, {
      el: null,
      options: Object.assign({
        autoShow: true,
      }, options),

      _setBuilder: null,
    });

    this.el = this.render();
    this.els = {
    };

    if (options.autoShow)
      this.el.classList.add('show');
    else
      this.el.classList.add('hide');
  }

  show() {
    this.el.classList.remove('hide');
    this.el.classList.add('show');
  }
  async fadeIn() {
    if (!this.el.classList.contains('hide'))
      return;
    this.el.style.display = 'flex';
    getComputedStyle(this.el).opacity;
    this.el.classList.remove('hide');
    return whenTransitionEnds(this.el, () => this.el.style.display = '');
  }
  async fadeOut() {
    if (this.el.classList.contains('hide'))
      return;
    this.el.style.display = 'flex';
    getComputedStyle(this.el).opacity;
    this.el.classList.remove('hide');
    return whenTransitionEnds(this.el, () => this.el.style.display = '');
  }
  hide() {
    this.el.classList.remove('show');
    this.el.classList.add('hide');
  }

  render() {
    const options = this.options;
    const divRoot = document.createElement('DIV');
    divRoot.classList.add('component');
    divRoot.classList.add('spinner');
    divRoot.innerHTML = options.content;

    return divRoot;
  }
};

emitter(Spinner);
