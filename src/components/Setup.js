import 'components/Setup.scss';
import { gameConfig } from 'config/client.js';
import ColorPicker from 'components/ColorPicker.js';
import AvatarPicker from 'components/Modal/AvatarPicker.js';
import emitter from 'utils/emitter.js';

const teamIds = [ 'N', 'E', 'S', 'W' ];

const template = `
  <DIV class="sets">
    <DIV class="set" data-slot="default"><DIV class="details"></DIV><DIV class="image"></DIV></DIV>
    <DIV class="set" data-slot="alt1"><DIV class="details"></DIV><DIV class="image"></DIV></DIV>
    <DIV class="set" data-slot="alt2"><DIV class="details"></DIV><DIV class="image"></DIV></DIV>
    <DIV class="set" data-slot="alt3"><DIV class="details"></DIV><DIV class="image"></DIV></DIV>
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
      setDefaultDetails: this.el.querySelector('.set[data-slot=default] .details'),
      setDefaultImage: this.el.querySelector('.set[data-slot=default] .image'),
      setAlt1Details: this.el.querySelector('.set[data-slot=alt1] .details'),
      setAlt1Image: this.el.querySelector('.set[data-slot=alt1] .image'),
      setAlt2Details: this.el.querySelector('.set[data-slot=alt2] .details'),
      setAlt2Image: this.el.querySelector('.set[data-slot=alt2] .image'),
      setAlt3Details: this.el.querySelector('.set[data-slot=alt3] .details'),
      setAlt3Image: this.el.querySelector('.set[data-slot=alt3] .image'),
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
        this.editSet(set.dataset.slot);
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

  async setGameType(gameType) {
    const [ sets ] = await Promise.all([
      Tactics.gameClient.getPlayerSets(gameType.id),
      this.loadAvatars(),
      Tactics.load(gameType.getUnitTypes()),
    ]);
    this.gameType = gameType;
    this.sets = new Map(sets.map(s => [ s.slot, s ]));

    this._setBuilder ??= await Tactics.setBuilder;
    this._setBuilder.gameType = gameType;
    this.els.sets.classList.add(`rotation-${this._setBuilder.board.rotation}`);

    if (!this.colorIds) {
      this.colorIds = gameConfig.teamColorIds;
      this.renderColorIds();
    }

    this.els.sets.classList.toggle('isCustomizable', gameType.isCustomizable);
    return this.renderSets();
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
  async onSetSave(rotation, set) {
    if (set.units.length)
      this.sets.set(set.slot, set);
    else
      this.sets.delete(set.slot);

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
      await this.renderSets();
      this.renderColorIds();
    } else
      this.renderSet(set.slot, { set, url:await this._setBuilder.getImage(set) });
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
  async renderSets() {
    if (!this._setBuilder || !this.colorIds)
      return;

    const slots = Array.from(gameConfig.setsBySlot.keys());
    const setsBySlot = new Map(await Promise.all(slots.map(slot => {
      const set = this.sets.get(slot) ?? { name:gameConfig.setsBySlot.get(slot), slot, units:[] };
      return this._setBuilder.getImage(set).then(url => [ slot, { set, url } ]);
    })));

    for (const slot of slots)
      if (slot === 'default' || this.gameType.isCustomizable)
        this.renderSet(slot, setsBySlot.get(slot));
  }
  renderSet(slot, { set, url }) {
    const details = [
      `<DIV class="name">${this.gameType.isCustomizable ? set.name : '(Not Customizable)'}</DIV>`,
    ];
    if (set.stats) {
      if (set.stats.rank)
        details.push(`<DIV class="rating">Rating: ${set.stats.rating} #${set.stats.rank}</DIV>`);
      else if (set.stats.rating)
        details.push(`<DIV class="rating">Rating: ${set.stats.rating}</DIV>`);
      else
        details.push(`<DIV class="unrated">Unrated</DIV>`);
      details.push(`<DIV class="gameCount">Games: ${set.stats.gameCount}</DIV>`);
      details.push(`<DIV class="playerCount">Players: ${set.stats.playerCount}</DIV>`);
    } else if (set.units.length)
      details.push(`<DIV class="new">New!</DIV>`);

    this.els[`set${slot.toUpperCase('first')}Details`].innerHTML = details.join('');
    this.els[`set${slot.toUpperCase('first')}Image`].style.backgroundImage = `url(${url})`;
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

  async editSet(slot) {
    const setBuilder = this._setBuilder;
    setBuilder.set = this.sets.get(slot) ?? { slot, units:[] };
    await setBuilder.show();

    return this.onSetSave(setBuilder.board.rotation, setBuilder.set);
  }
};

emitter(Setup);
