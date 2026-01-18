import Modal from 'components/Modal.js';
import ViewSet from 'components/ViewSet.js';
import Spinner from 'components/Spinner.js';
import 'components/Modal/ViewSet.scss';
import { setParam, unsetParam } from '#utils/hashParams.js';

export default class ViewSetWrapper extends Modal {
  constructor(data = {}, options = {}) {
    options.autoShow = false;
    options.hideOnCancel = true;
    options.withHeader = true;

    super(options, {});

    this.root.classList.add('viewSet');
  }

  async show(gameTypeId, set, vsSet) {
    setParam('viewSet', await JSON.compress({ gameTypeId, set }));

    this._spinner.fadeIn();
    this._viewSet.setGameType(gameTypeId, set, vsSet).then(ss => {
      this.title = `Viewing ${ss.gameType.name} Set <SPAN class="setName">'${set.name}'</SPAN>`;
      this._spinner.hide();
      this._viewSet.el.classList.add('show');
    });
    return super.show();
  }
  hide() {
    unsetParam('viewSet');
    this._viewSet.el.classList.remove('show');
    return super.hide();
  }

  renderContent() {
    const content = document.createDocumentFragment();

    const viewSet = this._viewSet = new ViewSet();
    viewSet.on('search', () => this.hide());
    viewSet.on('link', () => this.hide());
    content.appendChild(viewSet.el);

    const spinner = this._spinner = new Spinner({ autoShow:false });
    content.appendChild(spinner.el);

    return super.renderContent(content);
  }
};
