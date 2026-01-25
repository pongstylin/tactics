import { unitTypeByCode } from '#tactics/unitData.js';
import 'components/ViewSet.scss';
import ConfigureGameModal from 'components/Modal/ConfigureGame.js';
import popup from 'components/popup.js';
import { gameConfig } from 'config/client.js';
import emitter from 'utils/emitter.js';

const share = navigator.share ? 'share' : 'copy';
const template = `
  <DIV class="player"></DIV>
  <DIV class="header">
    <DIV class="left">
      <SELECT name="slot"></SELECT>
      <BUTTON name="save" class="fa fa-save" title="Save"></BUTTON>
    </DIV>
    <DIV class="right">
      <BUTTON name="play" class="fa fa-p" title="Play"></BUTTON>
      <BUTTON name="search" class="fa fa-search" title="Search"></BUTTON>
      <BUTTON name="share" class="fa fa-${share}" title="${share.toUpperCase('first')}"></BUTTON>
    </DIV>
  </DIV>
  <DIV class="set"><DIV class="details"></DIV><DIV class="image"></DIV></DIV>
  <DIV class="tags">
    <DIV class="label">Search Tags:</DIV>
    <DIV class="container"></DIV>
  </DIV>
`;

export default class ViewSet {
  constructor(data = {}, options = {}) {
    Object.assign({
      set: null,
    }, data);

    options.content = template;

    Object.assign(this, {
      el: null,
      data,
      options,

      gameType: null,
      playerSets: null,
      players: null,
      set: null,
      vsSet: null,
      teamInfo: null,

      _setBuilder: null,
      _configureGame: null,
    });

    this.el = this.render();
    this.els = {
      player: this.el.querySelector('.player'),
      saveSlot: this.el.querySelector('.header SELECT[name=slot]'),
      saveButton: this.el.querySelector('.header BUTTON[name=save]'),
      playButton: this.el.querySelector('.header BUTTON[name=play]'),
      searchButton: this.el.querySelector('.header BUTTON[name=search]'),
      shareButton: this.el.querySelector('.header BUTTON[name=share]'),
      set: this.el.querySelector('.set'),
      setDetails: this.el.querySelector('.set .details'),
      setImage: this.el.querySelector('.set .image'),
      tags: this.el.querySelector('.tags .container'),
    };

    this.els.saveButton.addEventListener('click', () => this.saveSet(this.els.saveSlot.value));
    this.els.playButton.addEventListener('click', () => this.play());
    this.els.searchButton.addEventListener('click', () => this.search());
    this.els.shareButton.addEventListener('click', () => this.share());
    this.el.addEventListener('click', event => {
      if (event.target.closest('A'))
        this._emit({ type:'link' });
    });

    for (const [ slot, slotName ] of gameConfig.setsBySlot) {
      const option = document.createElement('OPTION');
      option.value = slot;
      option.textContent = slotName;
      this.els.saveSlot.appendChild(option);
    }
  }

  get tags() {
    const typeSeq = new Map([
      [ 'inventor', 0 ],
      [ 'credit',   1 ],
      [ 'name',     2 ],
      [ 'unit',     3 ],
      [ 'position', 4 ],
      [ 'type',     5 ],
    ]);
    return this.gameType.getTeamSetTags(this.set).filter(t => t.type !== 'keyword' && (t.type !== 'unit' || (t.count ?? 1) > 0)).sort((a,b) =>
      typeSeq.get(a.type) - typeSeq.get(b.type) ||
      (b.count ?? 1) - (a.count ?? 1) ||
      a.name.localeCompare(b.name)
    );
  }

  async setGameType(inGameType, set, vsSet = null, teamInfo = null) {
    const [ gameType, playerSets, players ] = await Promise.all([
      typeof inGameType === 'string' ? Tactics.gameClient.getGameType(inGameType).then(gt => Tactics.load(gt.getUnitTypes()).then(() => gt)) : inGameType,
      Tactics.gameClient.getPlayerSets(typeof inGameType === 'string' ? inGameType : inGameType.id),
      Tactics.authClient.getPlayers([ set.stats.createdBy, set.stats.mostPlayedBy ]),
    ]);

    this.gameType = gameType;
    this.playerSets = playerSets;
    this.players = players;
    this.set = set;
    this.vsSet = vsSet;
    this.teamInfo = teamInfo;

    this.renderPlayer();
    this.renderPlayerSets();

    this._setBuilder ??= await Tactics.setBuilder;
    this._setBuilder.gameType = gameType;
    this.els.set.classList.add(`rotation-${this._setBuilder.board.rotation}`);

    this.el.classList.toggle('isCustomizable', gameType.isCustomizable);
    await this.renderSet();
    return this;
  }

  render() {
    const options = this.options;
    const divView = document.createElement('DIV');
    divView.classList.add('view');
    divView.classList.add('viewSet');
    divView.innerHTML = options.content;

    return divView;
  }
  renderPlayer() {
    this.els.player.innerHTML = '';
    if (!this.teamInfo || !this.teamInfo.ranks) return;

    this.els.player.append(`Want to view the rankings for `);

    const team = this.teamInfo.team;
    const playerLink = document.createElement('A');
    playerLink.href = `#rankings/${team.playerId}/FORTE`;
    playerLink.addEventListener('click', () => this._emit('link'));
    playerLink.textContent = team.name;
    this.els.player.appendChild(playerLink);

    this.els.player.append(`?`);
  }
  renderPlayerSets() {
    for (const [ slot, slotName ] of gameConfig.setsBySlot) {
      const playerSet = this.playerSets.find(ps => ps.slot === slot);
      const option = this.els.saveSlot.querySelector(`OPTION[value=${slot}]`);
      option.textContent = playerSet?.name ?? slotName;
    }
  }
  async renderSet() {
    const set = this.set;
    const playerSet = this.playerSets.find(ps => ps.id === set.id);
    const imagePromise = Tactics.getSetImage(this.gameType, set);
    const tags = this.tags;

    const details = [
      `<DIV class="name">${this.gameType.isCustomizable ? playerSet?.name ?? set.name : '(Not Customizable)'}</DIV>`,
    ];
    if (set.stats) {
      if (set.stats.createdBy && this.players.has(set.stats.createdBy)) {
        const player = this.players.get(set.stats.createdBy);
        if (player.rated)
          details.push(`<DIV class="createdBy">Created By: <A href="online.html#rankings/${player.playerId}/FORTE">${player.name}</A></DIV>`);
        else
          details.push(`<DIV class="createdBy">Created By: ${player.name}</DIV>`);
      }
      if (set.stats.mostPlayedBy && set.stats.mostPlayedBy !== set.stats.createdBy) {
        const player = this.players.get(set.stats.mostPlayedBy);
        if (player.rated)
          details.push(`<DIV class="mostPlayedBy">Most Played By: <A href="online.html#rankings/${player.playerId}/FORTE">${player.name}</A></DIV>`);
        else
          details.push(`<DIV class="mostPlayedBy">Most Played By: ${player.name}</DIV>`);
      }
      if (set.stats.rank)
        details.push(`<DIV class="rating">Rating: ${set.stats.rating} #${set.stats.rank}</DIV>`);
      else if (set.stats.rating)
        details.push(`<DIV class="rating">Rating: ${set.stats.rating}</DIV>`);
      else
        details.push(`<DIV class="unrated">Unrated</DIV>`);
      details.push(`<DIV class="gameCount">Games: ${set.stats.gameCount}</DIV>`);
      details.push(`<DIV class="playerCount">Players: ${set.stats.playerCount}</DIV>`);
    } else
      details.push(`<DIV class="new">New!</DIV>`);

    this.els.setDetails.innerHTML = details.join('');
    imagePromise.then(url => this.els.setImage.style.backgroundImage = `url(${url})`);

    this.els.tags.innerHTML = '';
    for (const tag of tags) {
      const divTag = document.createElement('DIV');
      divTag.classList.add('tag');
      divTag.title = `Keywords: ${(tag.keywords ?? []).concat(tag.name).sort().join(', ')}`;

      const spnTagType = document.createElement('SPAN');
      spnTagType.classList.add('type');
      spnTagType.textContent = tag.type.toUpperCase('first');
      divTag.appendChild(spnTagType);

      const spnTagName = document.createElement('SPAN');
      spnTagName.classList.add('name');
      spnTagName.textContent = tag.type === 'unit'
        ? (tag.count === undefined ? '' : `${tag.count} `) + unitTypeByCode.get(tag.name).name
        : tag.name.toUpperCase('first');
      divTag.appendChild(spnTagName);

      this.els.tags.appendChild(divTag);
    }

    await imagePromise;
  }

  async saveSet(slot) {
    const originalSetIndex = this.playerSets.findIndex(ps => ps.slot === slot);
    const originalSet = originalSetIndex > -1 ? this.playerSets[originalSetIndex] : { slot, units:[] };
    const ok = await popup({
      title: 'Save Set',
      message: originalSet.name
        ? `Would you like to replace the ${originalSet.name} set with this one?`
        : `Would you like to save this set to the ${slot.toUpperCase('first')} slot?`,
      buttons: [ 'Ok', 'Cancel' ],
    }).whenClosed;
    if (ok !== 'Ok') return;

    const setBuilder = this._setBuilder;
    setBuilder.set = originalSet;
    setBuilder.reset(this.set.name, this.set.units);
    await setBuilder.show();

    if (setBuilder.set.id === originalSet.id && setBuilder.set.name === originalSet.name)
      return;
    this.playerSets[originalSetIndex] = setBuilder.set;
    this.renderPlayerSets();
  }
  async play() {
    this._configureGame ??= new ConfigureGameModal({
      autoShow: false,
      hideOnCancel: true,
    });
    await this._configureGame.setGameType(this.gameType.id);
    this._configureGame.show('playWithSet', { set:this.set });
  }
  async search() {
    const choice = await popup({
      className: 'viewSet-search',
      title: 'Search',
      buttons: [
        'Find Similar Sets',
        'Find Games With Set',
        ...(this.vsSet ? [ 'Find Games Between Sets' ] : []),
      ],
    }).whenClosed;

    if (choice === 'Find Similar Sets') {
      const linkTags = this.tags.filter(t => [ 'unit', 'position', 'type' ].includes(t.type));
      location.href = `online.html#lobby/${this.gameType.id}/searchSets?` + new URLSearchParams({
        q: linkTags.filter(t => !!t).map(t => t.count ? `${t.count}${t.name}` : t.name).join(' '),
      });
      this._emit({ type:'search' });
    } else if (choice === 'Find Games With Set') {
      location.href = `online.html#lobby/${this.gameType.id}/searchSetGames?` + new URLSearchParams({
        set: await JSON.compress(this.set),
      });
      this._emit({ type:'search' });
    } else if (choice === 'Find Games Between Sets') {
      location.href = `online.html#lobby/${this.gameType.id}/searchSetGames?` + new URLSearchParams({
        set: await JSON.compress(this.set),
        vsSet: await JSON.compress(this.vsSet),
      });
      this._emit({ type:'search' });
    }
  }
  share() {
    return this._setBuilder.share();
  }
};

emitter(ViewSet);
