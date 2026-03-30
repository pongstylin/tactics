import Modal from 'components/Modal.js';
import SearchSets from 'components/SearchSets.js';
import Spinner from 'components/Spinner.js';
import 'components/Modal/SetPicker.scss';

export default class SetPicker extends Modal {
  constructor(data = {}, options = {}) {
    options.autoShow = false;
    options.hideOnCancel = true;
    options.withHeader = true;

    super(options, {
      pickedSet: null,
    });

    this.root.classList.add('setPicker');
  }

  async show(gameType) {
    if (typeof gameType === 'string')
      gameType = await Tactics.gameClient.getGameType(gameType);

    this.pickedSet = null;
    this._spinner.fadeIn();
    this._searchSets.setGameType(gameType).then(ss => {
      this.title = `Select Set`;
      this._spinner.hide();
      this._searchSets.el.classList.add('show');
    });
    return super.show().then(() => this.pickedSet);
  }
  hide() {
    this._searchSets.el.classList.remove('show');
    return super.hide();
  }

  renderContent() {
    const content = document.createDocumentFragment();

    const searchSets = this._searchSets = new SearchSets({ scrollElement:this._els.content });
    searchSets.on('select', ({ set }) => {
      this.pickedSet = set;
      this.hide();
    });
    content.appendChild(searchSets.el);

    const spinner = this._spinner = new Spinner({ autoShow:false });
    content.appendChild(spinner.el);

    return super.renderContent(content);
  }
};
