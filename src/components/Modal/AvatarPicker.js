import Modal from 'components/Modal.js';
import ColorPicker from 'components/ColorPicker.js';
import unitDataMap from 'tactics/unitData.js';

import 'components/Modal/AvatarPicker.scss';

const template = `
  <DIV class="color">
    <LABEL>Color</LABEL>
  </DIV>
`;

export default class AvatarPicker extends Modal {
  constructor(data, options = {}) {
    options.title = 'Choose Your Avatar';
    options.content = template;
    options.autoShow = false;
    options.hideOnCancel = true;

    super(options, data);

    Object.assign(this, {
      _colorPicker: null,
    });

    Object.assign(this._els, {
      color: this._els.content.querySelector('.color'),
    });

    this.root.classList.add('avatarPicker');

    const colorPicker = this._colorPicker = new ColorPicker({ colorId:this.data.avatar.colorId });
    colorPicker.on('change', ({ data:colorId }) => this.onColorChange(colorId));
    this._els.color.appendChild(colorPicker.root);

    const selectedAvatar = this.data.avatar;

    for (const unitType of this.data.unitTypes) {
      const divAvatar = document.createElement('DIV');
      divAvatar.classList.add('avatar');
      divAvatar.classList.toggle('selected', unitType === selectedAvatar.unitType);
      divAvatar.dataset.unitType = unitType;
      this._els.content.appendChild(divAvatar);

      const lblAvatar = document.createElement('LABEL');
      lblAvatar.textContent = unitDataMap.get(unitType).name;
      divAvatar.appendChild(lblAvatar);

      const divImage = document.createElement('DIV');
      divImage.classList.add('image');
      divAvatar.appendChild(divImage);

      const imgAvatar = Tactics.getAvatarImage({ unitType, colorId:selectedAvatar.colorId });
      imgAvatar.title = 'Select Avatar';
      divImage.appendChild(imgAvatar);
    }

    this._els.content.addEventListener('click', event => {
      const divAvatar = event.target.closest('.avatar');
      if (!divAvatar) return;

      this.onAvatarChange(divAvatar.dataset.unitType);
      event.stopPropagation();
    });
  }

  /*****************************************************************************
   * Public Methods
   ****************************************************************************/
  onColorChange(colorId) {
    this._emit({ type:'change', data:{ unitType:this.data.avatar.unitType, colorId } });

    const divAvatars = this._els.content.querySelectorAll('.avatar');
    for (const divAvatar of divAvatars) {
      const imgAvatar = Tactics.getAvatarImage({ unitType:divAvatar.dataset.unitType, colorId });
      imgAvatar.title = 'Select Avatar';

      const divImage = divAvatar.querySelector('.image');
      divImage.innerHTML = '';
      divImage.appendChild(imgAvatar);
    }

    this.data.avatar.colorId = colorId;
  }
  onAvatarChange(unitType) {
    if (unitType === this.data.avatar.unitType)
      return this.hide();

    this._emit({ type:'change', data:{ unitType, colorId:this.data.avatar.colorId } });
    this.hide();

    this._els.content.querySelector('.avatar.selected').classList.remove('selected');
    this._els.content.querySelector(`.avatar[data-unit-type=${unitType}]`).classList.add('selected');

    this.data.avatar.unitType = unitType;
  }
};
