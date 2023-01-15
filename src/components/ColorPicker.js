import 'components/ColorPicker.scss';
import emitter from 'utils/emitter.js';

const template = `
  <BUTTON class="colorOption" data-value="Blue"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="Teal"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="Green"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="Orange"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="Brown"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="Yellow"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="Red"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="Pink"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="Purple"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="Black"><DIV class="image"></DIV></BUTTON>
  <BUTTON class="colorOption" data-value="White"><DIV class="image"></DIV></BUTTON>
`;

export default class ColorPicker {
  constructor(data = {}) {
    Object.assign(this, {
      data,

      _els: {},
    });

    const root = this._els.root = document.createElement('DIV');
    root.classList.add('colorPicker');
    root.innerHTML = template;

    root.addEventListener('click', event => {
      const btnColorOption = event.target.closest('.colorOption');
      if (btnColorOption && !btnColorOption.classList.contains('selected'))
        this._onPick(btnColorOption);
      event.stopPropagation();
    });

    if (this.data.colorId)
      this._selectColorId(this.data.colorId);
  }

  get root() {
    return this._els.root;
  }

  get colorId() {
    return this.data.colorId;
  }
  set colorId(colorId) {
    if (colorId === this.data.colorId)
      return;

    this._selectColorId(colorId);
    this.data.colorId = colorId;
  }

  _selectColorId(colorId) {
    const root = this._els.root;
    root.querySelector('.selected')?.classList.remove('selected');
    root.querySelector(`[data-value=${colorId}]`).classList.add('selected');
  }
  _onPick(btnColorOption) {
    this.colorId = btnColorOption.dataset.value;
    this._emit({ type:'change', data:btnColorOption.dataset.value });
  }
}

emitter(ColorPicker);
