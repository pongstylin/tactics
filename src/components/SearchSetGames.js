import 'components/SearchSetGames.scss';
import * as gameCard from 'components/GameCard.js';
import { renderSet } from 'components/GameTeamSet.js';
import popup from 'components/popup.js';
import SetPicker from 'components/Modal/SetPicker.js';
import emitter from 'utils/emitter.js';
import sleep from 'utils/sleep.js';

const template = `
  <DIV class="sets">
    <SELECT name="result">
      <OPTION value="">VS</OPTION>
      <OPTION value="W">Win!</OPTION>
      <OPTION value="L">Lose!</OPTION>
    </SELECT>
  </DIV>
  <DIV class="game-list show-results"></DIV>
  <DIV class="footer"></DIV>
`;

export default class SearchSetGames {
  constructor(data = {}, options = {}) {
    Object.assign(data, {
      gameTypeId: null,
    }, data);

    options.content = template;

    Object.assign(this, {
      el: null,
      data,
      options,

      _setPicker: new SetPicker(),

      gameType: null,
      set: null,
      vsSet: null,
      gamesSummary: null,

      offset: 0,
      limit: 20,
    });

    this.el = this.render();
    this.els = {
      sets: this.el.querySelector('.sets'),
      set: renderSet(),
      vsSet: renderSet(),
      result: this.el.querySelector('SELECT[name=result'),
      gameList: this.el.querySelector('.game-list'),
      footer: this.el.querySelector('.footer'),
    };

    this.els.set.addEventListener('click', () => this.selectSet());
    this.els.sets.appendChild(this.els.set);

    this.els.vsSet.addEventListener('click', () => this.selectVSSet());
    this.els.sets.appendChild(this.els.vsSet);

    this.els.result.addEventListener('change', event => {
      this.params.result = event.target.value === '' ? null : event.target.value;
      event.target.blur();
      this.fetchFirstPage();
    });

    this.els.gameList.addEventListener('click', async event => {
      event.stopPropagation();

      const divGame = event.target.closest('.game');
      if (!divGame) return;

      const divArena = event.target.closest('.arena');
      if (divArena) {
        location.href = 'game.html?' + divGame.id;
        return;
      }

      const divTeam = event.target.closest('.team');
      if (divTeam) {
        const gameSummary = this.gamesSummary.find(g => g.id === divGame.id);
        const team = gameSummary.teams[parseInt(divTeam.dataset.id)]

        if (event.target.closest('.name'))
          this._emit({ type:'select:player', playerId:team.playerId })
        else if (event.target.closest('.set')) {
          const [ teamSet, vsTeamSet ] = await Promise.all([
            Tactics.gameClient.getGameTeamSet(divGame.dataset.type, gameSummary.id, team.id),
            Tactics.gameClient.getGameTeamSet(divGame.dataset.type, gameSummary.id, (team.id + 1) % 2),
          ]);

          this._emit({ type:'select:set', set:teamSet, vsSet:vsTeamSet });
        }
      }
    });

    window.addEventListener('scroll', () => {
      if (!this.el.classList.contains('show')) return;

      this.fetchNextPageIfNeeded();
    }, { passive:true });
  }

  get hasNextPage() {
    return this.gamesSummary.length < this.result.total.count && !this.result.total.truncated;
  }

  async setGameType(gameType, set, vsSet = null) {
    if (gameType.id === this.gameType?.id && set === this.set && vsSet === this.vsSet) return;

    await Tactics.load(gameType.getUnitTypes());
    this.gameType = gameType;
    this.set = set;
    this.vsSet = vsSet;
    this.params = {
      setId: set.id,
      vsSetId: vsSet && vsSet.id,
      result: null,
    };

    this.els.set.component.reset(gameType, set);
    this.els.vsSet.component.reset(gameType, vsSet ?? { name:'Select Set...', units:[] });
    this.els.result.value = '';

    return this.fetchFirstPage();
  }
  async fetchFirstPage() {
    this.els.footer.textContent = '';
    this.els.gameList.innerHTML = '';
    this.gamesSummary = [];
    this.offset = 0;

    try {
      await this.search();
    } catch (e) {
      if (e.code === 412) {
        this.els.footer.textContent = `Error: ${e.message}`;
        return;
      }
      this.els.footer.textContent = `Search failed.`;
      throw e;
    }
  }
  async fetchNextPageIfNeeded() {
    if (!this.hasNextPage) return;
    if (this.isFetching) return;

    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    const rowHeight = document.querySelector('.searchSetGames .set').offsetHeight;

    if (scrollHeight - clientHeight < scrollTop + rowHeight*2)
      return this.fetchNextPage();
  }
  async fetchNextPage() {
    this.offset += this.limit;

    try {
      await this.search();
    } catch (e) {
      this.els.footer.textContent = `Fetching more results failed.`;
      throw e;
    }
  }
  async search() {
    this.isFetching = true;
    this.result = await Tactics.gameClient.searchTeamSetGames(this.gameType.id, {
      ...this.params,
      offset: this.offset,
      limit: this.limit,
    });
    this.gamesSummary = this.gamesSummary.concat(this.result.gamesSummary);
    await this.renderGames();
    this.isFetching = false;
    sleep().then(() => this.fetchNextPageIfNeeded());
  }

  render() {
    const options = this.options;
    const divView = document.createElement('DIV');
    divView.classList.add('view');
    divView.classList.add('searchSetGames');
    divView.innerHTML = options.content;

    return divView;
  }
  async renderGames() {
    if (this.result.gamesSummary.length === 0)
      this.els.footer.textContent = 'No games found.';
    else if (this.result.total.truncated)
      this.els.footer.textContent = `Max results reached.`;
    else if (this.result.total.count === this.gamesSummary.length)
      this.els.footer.textContent = `No results remain.`;
    else
      this.els.footer.textContent = `Loading more results...`;

    const divGames = await Promise.all(this.result.gamesSummary.map(gs => {
      for (const team of gs.teams)
        if (team.set.id === this.set.id)
          team.set.name = this.set.name;
        else if (team.set.id === this.vsSet?.id)
          team.set.name = this.vsSet.name;

      return gameCard.renderGame(gs, { setId:this.set.id });
    }));
    const divGamesFragment = document.createDocumentFragment();
    for (const divGame of divGames)
      divGamesFragment.appendChild(divGame);
    this.els.gameList.appendChild(divGamesFragment);
  }
  async selectSet() {
    const choice = await popup({
      buttons: [ 'View Set', 'Change Set' ],
    }).whenClosed;

    if (choice === 'View Set')
      this._emit({ type:'select:set', set:this.set });
    else if (choice === 'Change Set') {
      const set = await this._setPicker.show(this.gameType);
      if (!set) return;

      this.set = set;
      this.params.setId = set.id;
      this.els.set.component.reset(this.gameType, set);
      this._emit({ type:'search', set, vsSet:this.vsSet });
      this.fetchFirstPage();
    }
  }
  async selectVSSet() {
    const choice = !this.vsSet ? 'Select Set' : await popup({
      buttons: [ 'View Set', 'Change Set', 'Clear Set' ],
    }).whenClosed;

    if (choice === 'View Set')
      this._emit({ type:'select:set', set:this.vsSet });
    else if (choice === 'Select Set' || choice === 'Change Set') {
      const vsSet = await this._setPicker.show(this.gameType);
      if (!vsSet) return;

      this.vsSet = vsSet;
      this.params.vsSetId = vsSet.id;
      this.els.vsSet.component.reset(this.gameType, vsSet);
      this._emit({ type:'search', set:this.set, vsSet });
      this.fetchFirstPage();
    } else if (choice === 'Clear Set') {
      this.vsSet = null;
      this.params.vsSetId = null;
      this.els.vsSet.component.reset(this.gameType, { name:'Select Set...', units:[] });
      this._emit({ type:'search', set:this.set, vsSet:null });
      this.fetchFirstPage();
    }
  }
};

emitter(SearchSetGames);
