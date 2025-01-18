import whenTransitionEnds from 'components/whenTransitionEnds.js';

import 'components/Setup.scss';
import { gameConfig } from 'config/client.js';
import popup from 'components/popup.js';
import ColorPicker from 'components/ColorPicker.js';
import AvatarPicker from 'components/Modal/AvatarPicker.js';
import emitter from 'utils/emitter.js';

const teamIds = [ 'N', 'E', 'S', 'W' ];

const template = `
  <DIV class="sets">
    <DIV class="set" data-id="default"><LABEL></LABEL><DIV class="image"></DIV></DIV>
    <DIV class="set" data-id="alt1"><LABEL></LABEL><DIV class="image"></DIV></DIV>
    <DIV class="set" data-id="alt2"><LABEL></LABEL><DIV class="image"></DIV></DIV>
    <DIV class="set" data-id="alt3"><LABEL></LABEL><DIV class="image"></DIV></DIV>
  </DIV>
  <DIV class="selectors">
    <DIV class="avatar">
      <LABEL>Avatar</LABEL>
      <DIV class="container"></DIV>
    </DIV>
    <DIV class="color">
      <LABEL>Team Color</LABEL>
    </DIV>
    <DIV class="teams">
      <LABEL>Team Position</LABEL>
      <DIV class="image">
        <DIV class="positions">
          <DIV class="position N"></DIV>
          <DIV class="position E"></DIV>
          <DIV class="position S"></DIV>
          <DIV class="position W"></DIV>
        </DIV>
      </DIV>
    </DIV>
  </DIV>
`;

export default class Setup {
  constructor(data = {}, options = {}) {
    Object.assign(data, {
      gameTypeId: null,
      avatar: null,
    }, data);

    options.content = template;

    Object.assign(this, {
      el: null,
      data,
      options,

      gameType: null,
      sets: null,
      avatars: null,
      colorIds: null,
      selectedTeamId: 'S',

      _avatarPicker: null,
      _colorPicker: null,
      _setBuilder: null,
    });

    this.el = this.render();
    this.els = {
      sets: this.el.querySelector('.sets'),
      setDefaultLabel: this.el.querySelector('.set[data-id=default] LABEL'),
      setDefaultImage: this.el.querySelector('.set[data-id=default] .image'),
      setAlt1Label: this.el.querySelector('.set[data-id=alt1] LABEL'),
      setAlt1Image: this.el.querySelector('.set[data-id=alt1] .image'),
      setAlt2Label: this.el.querySelector('.set[data-id=alt2] LABEL'),
      setAlt2Image: this.el.querySelector('.set[data-id=alt2] .image'),
      setAlt3Label: this.el.querySelector('.set[data-id=alt3] LABEL'),
      setAlt3Image: this.el.querySelector('.set[data-id=alt3] .image'),
      color: this.el.querySelector('.color'),
      avatar: this.el.querySelector('.avatar .container'),
      teams: this.el.querySelector('.teams .image'),
      teamN: this.el.querySelector('.teams .N'),
      teamE: this.el.querySelector('.teams .E'),
      teamS: this.el.querySelector('.teams .S'),
      teamW: this.el.querySelector('.teams .W'),
    };

    const colorPicker = this._colorPicker = new ColorPicker();
    colorPicker.on('change', ({ data:color }) => {
      this.setColorId(teamIds.indexOf(this.selectedTeamId), color);
    });
    this.els.color.appendChild(colorPicker.root);

    const avatars = Tactics.getSprite('avatars');
    this.els.teams.style.backgroundImage = `url(${avatars.getImage('arena').src})`;

    this.els.sets.addEventListener('click', event => {
      const set = event.target.closest('.set');
      if (set)
        this.editSet(set.dataset.id);
      event.stopPropagation();
    });

    this.els.avatar.addEventListener('click', () => this._avatarPicker.show());

    this.els.teams.addEventListener('click', event => {
      this.selectTeam(this._setBuilder.board.getRotation(this.selectedTeamId, 90));
    });
  }

  get avatar() {
    return this.data.avatar;
  }
  set avatar(avatar) {
    if (this.data.avatar && avatar.unitType === this.data.avatar.unitType && avatar.colorId === this.data.avatar.colorId)
      return;

    const imgAvatar = Tactics.getAvatarImage(avatar);
    imgAvatar.title = 'Change Avatar';

    this.els.avatar.innerHTML = '';
    this.els.avatar.appendChild(imgAvatar);

    this.data.avatar = avatar;
  }

  async setGameType(gameType, sets) {
    await Promise.all([
      this.loadAvatars(),
      Tactics.load(gameType.getUnitTypes()),
    ]);
    this.gameType = gameType;
    this.sets = new Map(sets.map(s => [ s.id, s ]));

    if (!this._setBuilder) {
      this._setBuilder = await (new Tactics.SetBuilder({ gameType })).init();
      this.els.sets.classList.add(`rotation-${this._setBuilder.board.rotation}`);
      this.colorIds = gameConfig.teamColorIds;
      this.renderColorIds();
    } else
      this._setBuilder.gameType = gameType;

    this.els.sets.classList.toggle('isCustomizable', gameType.isCustomizable);
    this.renderSets();
  }
  async loadAvatars() {
    if (this.avatars) return;

    this.avatars = await Tactics.gameClient.getMyAvatarList();

    this._avatarPicker = new AvatarPicker({ avatar:this.data.avatar.clone(), unitTypes:this.avatars })
      .on('change', event => this.onAvatarChange(event.data));
  }
  /*
   * Possible operations:
   *   Moving selection index 0 from Red to Red
   *   - Ignore as a redundant no-op
   *   Moving selection index 0 from Red to unselected Blue
   *   - Deselect Red
   *   - Select Blue with index 0
   *   Moving selection index 0 from Red to Blue selected with index 1
   *   - Reselect Red with index 1
   *   - Reselect Blue with index 0
   */
  setColorId(newIndex, newColorId) {
    const colorIds = this.colorIds;
    const oldColorId = this.colorIds[newIndex];
    const oldIndex = colorIds.findIndex(c => c === newColorId);
    const board = this._setBuilder.board;
    const degree = board.getDegree('S', board.rotation);
    const newSide = board.getRotation(teamIds[newIndex], degree);
    const oldSide = oldIndex === -1 ? null : board.getRotation(teamIds[oldIndex], degree);

    if (oldSide === null) {
      this.els[`team${newSide}`].classList.remove(oldColorId);
      this.els[`team${newSide}`].classList.add(newColorId);

      colorIds[newIndex] = newColorId;
    } else {
      /*
       * The new color for this team needs to be swapped with its old team.
       */
      this.els[`team${oldSide}`].classList.remove(newColorId);
      this.els[`team${oldSide}`].classList.add(oldColorId);

      this.els[`team${newSide}`].classList.remove(oldColorId);
      this.els[`team${newSide}`].classList.add(newColorId);

      colorIds[oldIndex] = colorIds[newIndex];
      colorIds[newIndex] = newColorId;
    }

    gameConfig.teamColorIds = this.colorIds;

    if (newIndex === 2 || oldIndex === 2) {
      this._setBuilder.colorId = this.colorIds[2];
      this.renderSets();
    }
  }

  onAvatarChange(avatar) {
    this.avatar = avatar;
    this._emit({ type:'change:avatar', data:{
      unitType: avatar.unitType,
      colorId: avatar.colorId,
    }});
  }
  onSetSave(rotation, set) {
    if (set.units.length)
      this.sets.set(set.id, set);
    else
      this.sets.delete(set.id);

    this._emit({
      type: 'change:sets',
      data: [ ...this.sets.values() ],
    });

    const rotationHasChanged = !this.els.sets.classList.contains(`rotation-${rotation}`);
    if (rotationHasChanged) {
      this.els.sets.classList.toggle('rotation-N', rotation === 'N');
      this.els.sets.classList.toggle('rotation-E', rotation === 'E');
      this.els.sets.classList.toggle('rotation-S', rotation === 'S');
      this.els.sets.classList.toggle('rotation-W', rotation === 'W');
      this.renderSets();
      this.renderColorIds();
    } else
      this.renderSet(set.id);
  }
  selectTeam(newTeamId) {
    const board = this._setBuilder.board;
    const degree = board.getDegree('S', board.rotation);
    const position = board.getRotation(newTeamId, degree);

    this._colorPicker.colorId = this.colorIds[teamIds.indexOf(newTeamId)];

    for (const teamId of teamIds) {
      this.els[`team${teamId}`].classList.toggle('selected', teamId === position);
    }

    this.selectedTeamId = newTeamId;
  }

  render() {
    const options = this.options;
    const divView = document.createElement('DIV');
    divView.classList.add('view');
    divView.classList.add('setup');
    divView.innerHTML = options.content;

    return divView;
  }
  renderSets() {
    if (!this._setBuilder || !this.colorIds)
      return;

    for (const id of gameConfig.setsById.keys()) {
      if (id === 'default' || this.gameType.isCustomizable)
        this.renderSet(id);
    }
  }
  renderSet(id) {
    const set = this.sets.get(id) ?? { id, units:[] };

    this._setBuilder.set = set;
    const image = this._setBuilder.getImage();

    this.els[`set${id.toUpperCase('first')}Label`].textContent = this.gameType.isCustomizable ? set.name : '(Not Customizable)';
    this.els[`set${id.toUpperCase('first')}Image`].style.backgroundImage = `url(${image.src})`;
  }
  renderColorIds() {
    const board = this._setBuilder.board;
    const degree = board.getDegree('S', board.rotation);

    for (const [ index, colorId ] of this.colorIds.entries()) {
      const position = board.getRotation(teamIds[index], degree);

      this.els.teams.querySelector(`.${colorId}`)?.classList.remove(colorId);
      this.els[`team${position}`].classList.add(colorId);
    }

    this.selectTeam(this.selectedTeamId);
  }

  async editSet(id) {
    const setBuilder = this._setBuilder;
    setBuilder.set = this.sets.get(id) ?? { id, units:[] };
    await setBuilder.show();

    this.onSetSave(setBuilder.board.rotation, setBuilder.set);
  }
};

emitter(Setup);
