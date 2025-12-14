import 'components/SearchSets.scss';
import { renderSet } from 'components/GameTeamSet.js';
import emitter from 'utils/emitter.js';
import sleep from 'utils/sleep.js';

const template = `
  <DIV class="controls">
    <INPUT type="text" name="text" placeholder="Enter search tags here..." spellcheck=false>
    <SELECT name="metricName">
      <OPTION value="rating">Top Rated</OPTION>
      <OPTION value="gameCount">Top Games</OPTION>
      <OPTION value="playerCount">Top Players</OPTION>
    </SELECT>
    <BUTTON name="search">Search</BUTTON>
  </DIV>
  <DIV class="message"></DIV>
  <DIV class="sets"></DIV>
  <DIV class="footer"></DIV>
`;

export default class SearchSets {
  constructor(data = {}, options = {}) {
    options.content = template;

    Object.assign(this, {
      el: null,
      data: Object.assign({}, {
        gameTypeId: null,
        scrollElement: document.documentElement,
      }, data),
      options,

      gameType: null,
      sets: null,
      searchText: '',

      offset: 0,
      limit: 24,

      _setBuilder: null,
    });

    this.el = this.render();
    this.els = {
      text: this.el.querySelector('INPUT[name=text]'),
      metricName: this.el.querySelector('SELECT[name=metricName'),
      search: this.el.querySelector('BUTTON[name=search]'),
      message: this.el.querySelector('.message'),
      sets: this.el.querySelector('.sets'),
      footer: this.el.querySelector('.footer'),
    };

    this.els.text.addEventListener('keypress', event => {
      if (event.keyCode === 13 || event.key === 'Enter')
        this.fetchFirstPage();
    }, { passive:true });
    this.els.text.addEventListener('focus', event => {
      event.target.select();
    });
    this.els.metricName.addEventListener('change', event => {
      event.target.blur();
      this.fetchFirstPage();
    });
    this.els.search.addEventListener('click', event => {
      this.fetchFirstPage();
    });

    this.els.sets.addEventListener('click', event => {
      const divSet = event.target.closest('.component.gameTeamSet');
      if (!divSet) return;
      const setId = divSet.dataset.id;
      const set = this.sets.find(s => s.id === setId);
      this._emit({ type:'select', set:{
        id: set.id,
        name: set.name,
        units: set.units,
        stats: set.stats,
      } });
      event.stopPropagation();
    });

    const scrollTarget = this.data.scrollElement === document.documentElement ? window : this.data.scrollElement;
    scrollTarget.addEventListener('scroll', () => {
      if (!this.el.classList.contains('show')) return;

      this.fetchNextPageIfNeeded();
    }, { passive:true });
  }

  get hasNextPage() {
    return this.sets.length < this.result.total.count && !this.result.total.truncated;
  }

  async setGameType(gameType, searchText = '') {
    if (gameType.id === this.gameType?.id && searchText === this.searchText) return;

    await Tactics.load(gameType.getUnitTypes());
    this.gameType = gameType;
    this.searchText = searchText;

    this._setBuilder ??= await Tactics.setBuilder;
    this._setBuilder.gameType = gameType;
    this.els.sets.classList.add(`rotation-${this._setBuilder.board.rotation}`);

    this.el.classList.toggle('isCustomizable', gameType.isCustomizable);
    this.els.text.value = searchText;

    return this.fetchFirstPage();
  }
  async fetchFirstPage() {
    this.els.message.textContent = 'Please wait...';
    this.els.footer.textContent = '';
    this.els.sets.innerHTML = '';
    this.sets = [];
    this.offset = 0;

    try {
      await this.search();
    } catch (e) {
      if (e.code === 412) {
        this.els.message.textContent = `Error: ${e.message}`;
        return;
      }
      this.els.message.textContent = `Search failed.`;
      throw e;
    }
  }
  async fetchNextPageIfNeeded() {
    if (!this.hasNextPage) return;
    if (this.isFetching) return;

    const { scrollTop, scrollHeight, clientHeight } = this.data.scrollElement;
    const rowHeight = document.querySelector('.searchSets .gameTeamSet').offsetHeight;

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
    this.result = await Tactics.gameClient.searchTeamSets(this.gameType.id, {
      text: this.els.text.value,
      metricName: this.els.metricName.value,
      offset: this.offset,
      limit: this.limit,
    });
    if (this.searchText !== this.els.text.value) {
      this.searchText = this.els.text.value;
      this._emit({ type:'search', searchText:this.searchText });
    }
    this.sets = this.sets.concat(this.result.teamSets);
    await this.renderSets();
    this.isFetching = false;
    sleep().then(() => this.fetchNextPageIfNeeded());
  }

  render() {
    const options = this.options;
    const divView = document.createElement('DIV');
    divView.classList.add('view');
    divView.classList.add('searchSets');
    divView.innerHTML = options.content;

    return divView;
  }
  async renderSets() {
    /*
     * For a smoother scrolling experience, load the dom before the images.
     */
    const divSets = document.createDocumentFragment();
    for (const set of this.result.teamSets)
      divSets.appendChild(renderSet(this.gameType, set));
    this.els.sets.appendChild(divSets);

    if (!this.gameType.isCustomizable)
      this.els.message.textContent = `Search unavailable for styles with fixed sets.`;
    else if (this.result.total.count)
      this.els.message.textContent = `Found${this.result.total.fuzzy ? ' up to' : ''} ${this.result.total.count.toLocaleString()} set${this.result.total.count > 1 ? 's' : ''}.`;
    else
      this.els.message.textContent = `No sets found matching all tags.`;

    if (this.result.total.truncated)
      this.els.footer.textContent = `Max results reached.`;
    else if (this.result.total.count === this.sets.length)
      this.els.footer.textContent = `No results remain.`;
    else
      this.els.footer.textContent = `Loading more results...`;
  }

  async editSet(setId) {
    const setBuilder = this._setBuilder;
    setBuilder.set = this.sets.find(s => s.id === setId);
    await setBuilder.show();

    this.onSetSave(setBuilder.board.rotation, setBuilder.set);
  }
};

emitter(SearchSets);
