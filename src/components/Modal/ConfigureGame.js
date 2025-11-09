import 'components/Modal/ConfigureGame.scss';
import Modal from 'components/Modal.js';
import { gameConfig } from 'config/client.js';
import styleConfig from 'config/styleConfig';
import Autosave from 'components/Autosave.js';
import popup from 'components/popup.js';
import ServerError from '#server/Error.js';

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;
const teamName = new Autosave({
  submitOnChange: true,
  defaultValue: false,
  value: 'Noob',
  maxLength: 20,
});
const challengee = new Autosave({
  submitOnInput: true,
  defaultValue: false,
  autoSetValue: false,
  maxLength: 20,
});
const cache = new Map();
const inApp = window.matchMedia('(display-mode:standalone)').matches;

export default class ConfigureGame extends Modal {
  constructor(options = {}) {
    options.title = 'Create Game';
    options.content = `
      <DIV class="intro"></DIV>
      <DIV class="audio">
        <DIV>Audio</DIV>
        <DIV class="indent">
          <LABEL><INPUT type="radio" name="audio" value="on"> On</LABEL>
          <LABEL><INPUT type="radio" name="audio" value="off"> Off</LABEL>
        </DIV>
      </DIV>
      <DIV class="confirm">
        <DIV>Confirm before you...</DIV>
        <DIV class="indent">
          <LABEL class="createGame"><INPUT type="checkbox" name="confirmBeforeCreate" value="true"> Create Game</LABEL>
          <LABEL class="joinGame"><INPUT type="checkbox" name="confirmBeforeJoin" value="true"> Join Game</LABEL>
        </DIV>
      </DIV>
      <DIV class="playerName">
        <DIV>What name would you like to use for this game?</DIV>
        <DIV class="indent"></DIV>
      </DIV>
      <DIV class="gameType">
        <DIV>What game style do you want to play?<SPAN class="fa fa-info style"></SPAN></DIV>
        <DIV class="indent">
          <SELECT name="type">
            <OPTION>Please wait...</OPTION>
          </SELECT><SPAN class="fa fa-info selected-style"></SPAN>
        </DIV>
      </DIV>
      <DIV class="visibility">
        <DIV>Choose game visibility:<SPAN class="fa fa-info collection"></SPAN></DIV>
        <DIV class="indent">
          <LABEL><INPUT type="radio" name="collection" value="public" checked> Public</LABEL>
          <LABEL><INPUT type="radio" name="collection" value="private"> Private</LABEL>
        </DIV>
      </DIV>
      <DIV class="vs">
        <DIV>Choose your opponent:<SPAN class="fa fa-info vs"></SPAN></DIV>
        <DIV class="indent">
          <LABEL class="vs-anybody"><INPUT type="radio" name="vs" value="anybody" checked> Anybody</LABEL>
          <LABEL class="vs-yourself" style="display:none"><INPUT type="radio" name="vs" value="yourself"> Yourself</LABEL>
          <LABEL class="vs-same"><INPUT type="radio" name="vs" value="same"> Same</LABEL>
          <LABEL><INPUT type="radio" name="vs" value="invite"> Share Link</LABEL>
          <LABEL><INPUT type="radio" name="vs" value="challenge"> Challenge</LABEL>
        </DIV>
        <DIV class="indent only" style="display:none">
          <DIV class="search"></DIV>
          <DIV class="matches"></DIV>
        </DIV>
      </DIV>
      <DIV class="as">
        <DIV>Who would you like to play as?</DIV>
        <DIV class="indent"></DIV>
      </DIV>
      <DIV class="set">
        <DIV>Choose set: <A href="javascript:void(0)" class="change" style="display:none">View Set</A><SPAN class="fa fa-info set"></SPAN></DIV>
        <DIV class="indent">
          <SELECT name="set">
            <OPTION value="default">Please wait...</OPTION>
            <OPTION value="alt1">Alternate 1</OPTION>
            <OPTION value="alt2">Alternate 2</OPTION>
            <OPTION value="alt3">Alternate 3</OPTION>
            <OPTION value="same">Same</OPTION>
            <OPTION value="mirror">Mirror</OPTION>
            <OPTION value="random">Random</OPTION>
          </SELECT>
        </DIV>
      </DIV>
      <DIV class="timeLimit">
        <DIV>Choose turn time limit:<SPAN class="fa fa-info timeLimitName"></SPAN></DIV>
        <DIV class="indent grid col4" style="max-width:300px">
          <DIV class="long col3">
            <SPAN class="label">Long:</SPAN>
            <LABEL><INPUT type="radio" name="timeLimitName" value="week" checked> Week</LABEL>
            <LABEL><INPUT type="radio" name="timeLimitName" value="day"> Day</LABEL>
          </DIV>
          <DIV class="short col4">
            <SPAN class="label">Short:</SPAN>
            <LABEL><INPUT type="radio" name="timeLimitName" value="pro"> Pro</LABEL>
            <LABEL><INPUT type="radio" name="timeLimitName" value="standard"> Standard</LABEL>
            <LABEL><INPUT type="radio" name="timeLimitName" value="blitz"> Blitz</LABEL>
          </DIV>
        </DIV>
      </DIV>
      <DIV class="customize">
        <DIV>Customize your game:<SPAN class="fa fa-info customize"></DIV>
        <DIV class="indent taglist">
          <SPAN class="randomSide"><LABEL><INPUT type="radio" name="randomSide" value="true">Random Side</LABEL></SPAN>
          <SPAN><LABEL><INPUT type="radio" name="randomHitChance" value="false">No Luck</LABEL></SPAN>
          <SPAN><LABEL><INPUT type="radio" name="rated" value="true">Rated</LABEL></SPAN>
          <SPAN><LABEL><INPUT type="radio" name="slot" value="1">1st Turn</LABEL></SPAN>
          <SPAN><LABEL><INPUT type="radio" name="rules" value="tournament">Tournament</LABEL></SPAN>
          <SPAN><LABEL><INPUT type="radio" name="rules" value="practice">Practice</LABEL></SPAN>
          <SPAN><LABEL><INPUT type="radio" name="rated" value="false">Unrated</LABEL></SPAN>
          <SPAN><LABEL><INPUT type="radio" name="slot" value="0">2nd Turn</LABEL></SPAN>
        </DIV>
      </DIV>
      <DIV class="message"></DIV>
      <DIV class="buttons">
        <LABEL class="remember">
          <SPAN class="fa fa-circle-check"></SPAN>
          Remember
        </LABEL>
        <BUTTON name="submit">Submit</BUTTON>
      </DIV>
    `;

    super(options, {
      whenReady: null,
      infoInProgress: false,
      changeInProgress: false,
      submitInProgress: false,
      gameTypes: null,
      gameType: null,
      styleConfigData: null,
    });

    const content = this._els.content;

    Object.assign(this._els, {
      divPlayerSetup: content.querySelector('.playerName .indent'),
      btnSubmit: content.querySelector('BUTTON[name=submit]'),
      divMessage: content.querySelector('.message'),
      divSearch: content.querySelector('.vs .search'),
      divMatches: content.querySelector('.vs .matches'),
      selGameType: content.querySelector('SELECT[name=type]'),
      selSet: content.querySelector('SELECT[name=set]'),
      aChangeLink: content.querySelector('.change'),

      set: content.querySelector('.set'),
      customize: content.querySelector('.customize'),
      buttons: content.querySelector('.buttons'),
      remember: content.querySelector('.remember'),
    });
    this.root.classList.add('configureGame');

    if (Tactics.audioBroken)
      this.root.querySelector('.audio').classList.add('broken');
    else
      this.root.querySelector(`INPUT[name=audio][value=${gameConfig.audio ? 'on' : 'off'}]`).checked = true;
    this.root.querySelector('INPUT[name=confirmBeforeCreate]').checked = gameConfig.confirmBeforeCreate;
    this.root.querySelector('INPUT[name=confirmBeforeJoin]').checked = gameConfig.confirmBeforeJoin;

    teamName.appendTo(this._els.divPlayerSetup);
    teamName.on('change', event => this._clearError());
    challengee.appendTo(this._els.divSearch);
    challengee.on('submit', event => this._onChallengeeSubmit(event));

    this.root.querySelector('.remember').addEventListener('click', event => this._saveStyleConfig());
    this.root.addEventListener('change', event => {
      this._clearError();
      this._toggleFields()
    });
    this.root.querySelector('.taglist').addEventListener('click', event => event.preventDefault());
    this.root.querySelectorAll('.taglist LABEL').forEach(e => e.addEventListener('pointerdown', event => {
      this._toggleFields(event.currentTarget.querySelector('INPUT'));
    }));
    this._els.selGameType.addEventListener('change', async event => {
      await this.setGameType(event.target.value);
      this._applyStyleConfig();
    });
    this._els.selSet.addEventListener('change', event => {
      this._els.aChangeLink.style.display = this._els.selSet.selectedIndex === 4 ? 'none' : '';
    });

    this._els.divMatches.addEventListener('click', event => this._onMatchesClick(event));
    this._els.aChangeLink.addEventListener('click', event => this._onChangeSet());

    this.root.querySelectorAll('INPUT[name=vs]').forEach(rad => {
      // Only the checked radio is fired on change
      rad.addEventListener('change', event => {
        const vsChallenge = event.target.value === 'challenge';
        if (vsChallenge && challengee.value === null)
          setTimeout(() => this._els.divSearch.querySelector('INPUT').focus(), 0);
      });
    });

    this.root.querySelector('.fa.fa-info.style').addEventListener('click', event => this._showGeneralStyleInfo());
    this.root.querySelector('.fa.fa-info.selected-style').addEventListener('click', event => this._showStyleInfo());
    this.root.querySelector('.fa.fa-info.collection').addEventListener('click', event => this._showCollectionInfo());
    this.root.querySelector('.fa.fa-info.vs').addEventListener('click', event => this._showVSInfo());
    this.root.querySelector('.fa.fa-info.set').addEventListener('click', event => this._showSetInfo());
    this.root.querySelector('.fa.fa-info.timeLimitName').addEventListener('click', event => this._showTimeLimitNameInfo());
    this.root.querySelector('.fa.fa-info.customize').addEventListener('click', event => this._showCustomizeInfo());

    this._els.btnSubmit.addEventListener('click', () => this._submit());

    /*
     * Load all data before showing the page.
     */
    this.data.whenReady = gameClient.getGameTypes().then(gameTypes => {
      teamName.value = authClient.playerName;

      this._els.selGameType.innerHTML = gameTypes.map(gt => `<OPTION value="${gt.id}">${gt.name}</OPTION>`).join('');
      this._els.selGameType.disabled = false;
      this.data.gameTypes = gameTypes;
    });
  }

  get gameTypeId() {
    return this.data.gameTypeId;
  }
  get gameType() {
    return cache.get(this.data.gameTypeId).gameType;
  }
  get sets() {
    return cache.get(this.data.gameTypeId).sets;
  }
  set sets(sets) {
    return cache.get(this.data.gameTypeId).sets = sets;
  }
  get styleConfigData() {
    return cache.get(this.data.gameTypeId).config.clone();
  }
  set styleConfigData(config) {
    Object.assign(cache.get(this.data.gameTypeId).config, config);
  }
  get styleConfigOverrides() {
    if (this.data.view === 'challenge')
      return { vs:'challenge', challengee:this.data.props.challengee };
    else if (this.data.view === 'forkGame')
      return { collection:'private' };
    else if (![ 'challenge', 'createGame' ].includes(this.data.view))
      return { collection:'public', vs:'anybody' };
    return {};
  }
  get adjustedStyleConfig() {
    return Object.assign({}, this.styleConfigData, this.styleConfigOverrides);
  }
  get confirmBeforeCreate() {
    if (this.sets.length > 1 && !styleConfig.has(this.data.gameTypeId) && styleConfig.get(this.data.gameTypeId).set !== 'random')
      return true;

    return gameConfig.confirmBeforeCreate;
  }
  get confirmBeforeJoin() {
    if (this.sets.length > 1 && !styleConfig.has(this.data.gameTypeId) && styleConfig.get(this.data.gameTypeId).set !== 'random')
      return true;

    return gameConfig.confirmBeforeJoin;
  }

  createGameOptions(view = this.data.view) {
    this.data.view = view;
    const timerType = [ 'challenge', 'createGame' ].includes(view) ? null : 'short';
    const styleConfigData = this.adjustedStyleConfig;

    return styleConfig.makeCreateGameOptions(this.gameType, { name:teamName.value, styleConfigData, timerType });
  }
  joinGameOptions(view = this.data.view, props = this.data.props) {
    this.data.view = view;
    this.data.props = props;
    const styleConfigData = this.adjustedStyleConfig;

    const myTeam = styleConfig.makeMyTeam(this.gameType, {
      name: teamName.value,
      isFork: props.gameSummary.mode === 'fork',
      styleConfigData,
    });
    delete myTeam.playerId;

    return myTeam;
  }

  async show(view, props = {}) {
    this.data.view = view;
    this.data.props = props;
    this.root.classList.toggle('challenge', view === 'challenge');
    this.root.classList.toggle('createGame', view === 'createGame');
    this.root.classList.toggle('forkGame', view === 'forkGame');
    this.root.classList.toggle('confirmBeforeCreate', view === 'confirmBeforeCreate');
    this.root.classList.toggle('confirmBeforeJoin', view === 'confirmBeforeJoin');
    this.root.classList.toggle('configureLobby', view === 'configureLobby');
    this.root.classList.toggle('configurePublic', view === 'configurePublic');

    switch (view) {
      case 'challenge':
        const opponent = await authClient.getRatedPlayer(props.challengee);
        if (!opponent)
          throw new Error(`Unable to challenge player: ${props.challengee}`);

        this.title = `Challenge ${opponent.name}`;
        this.data.timeLimitType = 'long';
        break;
      case 'createGame':
        this.title = 'Create Game';
        this.data.timeLimitType = 'long';
        break;
      case 'forkGame':
        await this.setGameType(props.game.state.type);
        this.title = 'Fork the game?';
        this.data.timeLimitType = 'long';
        break;
      case 'confirmBeforeCreate':
        this.title = 'Confirm Create Game';
        this.data.timeLimitType = 'short';
        break;
      case 'confirmBeforeJoin':
        this.title = `Want to play ${props.gameSummary.creator.name}?`;
        this.data.timeLimitType = null;
        break;
      case 'configureLobby':
        this.title = 'Arena Settings';
        this.data.timeLimitType = 'short';
        break;
      case 'configurePublic':
        this.title = 'Arena Settings';
        this.data.timeLimitType = null;
        break;
      default:
        throw new TypeError(`Unrecognized view '${view}'`);
    }

    await this._applyStyleConfig();

    return super.show();
  }

  async _onChallengeeSubmit(event) {
    const { divMatches } = this._els;

    const value = event.data;
    if (value === null) {
      // This is duplicated to avoid a flicker from clearing before awaiting.
      divMatches.innerHTML = '';
      challengee.value = null;
      return;
    }

    const matches = await authClient.queryRatedPlayers(value);

    divMatches.innerHTML = '';
    challengee.value = null;

    for (const match of matches) {
      if (match.relationship?.type === 'self')
        continue;

      const divMatch = document.createElement('DIV');
      divMatch.classList.add('match');
      divMatch.dataset.json = JSON.stringify(match);
      divMatches.append(divMatch);

      const showText = match.text !== undefined && match.text.toLowerCase() !== match.name.toLowerCase();

      const spnIdentity = document.createElement('SPAN');
      spnIdentity.classList.add('player');
      if (match.relationship)
        spnIdentity.classList.add(match.relationship.type);
      spnIdentity.title = 'View Player Ranking';
      spnIdentity.innerHTML = [
        `<SPAN class="name">${match.name}</SPAN>`,
        !showText ? '' : `<SPAN class="text">${match.text}</SPAN>`,
      ].join('');
      divMatch.append(spnIdentity);
    }

    if (divMatches.innerHTML === '')
      divMatches.innerHTML = 'No matches.';
  }

  _onMatchesClick(event) {
    const { divMatches } = this._els;
    const divMatch = event.target.closest('.match');
    if (!divMatch)
      return;

    const match = JSON.parse(divMatch.dataset.json);

    divMatches.innerHTML = '';

    challengee.value = match;
    challengee.inputValue = match.name;

    this._toggleFields();
  }

  // Select and lock: Must remain selected according to rules
  // Unselect and lock: Must remain unselected according to rules.
  // Select, lock, and auto: Only selected due to rules, will deselect on unlock.
  _setRadioState(radio, prop, value) {
    radio.parentNode.classList.toggle(prop, value);
    radio.checked = (
      !radio.parentNode.classList.contains('disabled') && (
        radio.parentNode.classList.contains('selected') ||
        radio.parentNode.classList.contains('required')
      )
    );
    radio.disabled = radio.parentNode.classList.contains('disabled');
  }

  async _toggleFields(activeRadio = null) {
    // Wait for the gameType to be loaded since we use it below
    await this.data.whenReady;

    const { divSearch, btnSubmit } = this._els;

    if (activeRadio) {
      const radioGroup = this.root.querySelectorAll(`INPUT[name=${activeRadio.name}]`);
      // Side-effect.  The radio is checked if required, even if not selected.
      // Effectively, that means you can't select a required field.  The attempt is ignored.
      if (activeRadio.checked) {
        this._setRadioState(activeRadio, 'selected', false);
      } else {
        for (const radio of radioGroup)
          this._setRadioState(radio, 'selected', radio === activeRadio);
      }
    }

    const radAudio = this.root.querySelector('INPUT[name=audio]:checked');
    if ((radAudio.value === 'on') !== gameConfig.audio) {
      gameConfig.audio = radAudio.value === 'on';
      Howler.mute(!gameConfig.audio);
    }

    const radConfirmBeforeCreate = this.root.querySelector('INPUT[name=confirmBeforeCreate]');
    if (radConfirmBeforeCreate.checked !== gameConfig.confirmBeforeCreate)
      gameConfig.confirmBeforeCreate = radConfirmBeforeCreate.checked;
    const radConfirmBeforeJoin = this.root.querySelector('INPUT[name=confirmBeforeJoin]');
    if (radConfirmBeforeJoin.checked !== gameConfig.confirmBeforeJoin)
      gameConfig.confirmBeforeJoin = radConfirmBeforeJoin.checked;

    const collection = this.root.querySelector('INPUT[name=collection]:checked').value;
    const radRandomSide = this.root.querySelector('INPUT[name=randomSide]');
    const radPractice = this.root.querySelector('INPUT[name=rules][value=practice]');
    const radTournament = this.root.querySelector('INPUT[name=rules][value=tournament]');
    const radRated = this.root.querySelector('INPUT[name=rated][value=true]');
    const radUnrated = this.root.querySelector('INPUT[name=rated][value=false]');

    if (this.data.view === 'forkGame') {
      const game = this.data.props.game;
      const showSame = !game.isSimulation && game.myTeam;

      this.root.querySelector('.vs-anybody').style.display = 'none';
      this.root.querySelector('.vs-yourself').style.display = '';
      this.root.querySelector('.vs-same').style.display = showSame ? '' : 'none';
      if (this.root.querySelector('INPUT[name=vs][value=anybody').checked)
        this.root.querySelector('INPUT[name=vs][value=yourself]').checked = true;
    } else {
      if (collection === 'public') {
        this.root.querySelector('.vs-anybody').style.display = '';
        this.root.querySelector('.vs-yourself').style.display = 'none';
        if (this.root.querySelector('INPUT[name=vs][value=yourself').checked)
          this.root.querySelector('INPUT[name=vs][value=anybody]').checked = true;
      } else {
        this.root.querySelector('.vs-anybody').style.display = 'none';
        this.root.querySelector('.vs-yourself').style.display = '';
        if (this.root.querySelector('INPUT[name=vs][value=anybody').checked)
          this.root.querySelector('INPUT[name=vs][value=yourself]').checked = true;
      }

      this.root.querySelector('.vs-same').style.display = 'none';
    }

    const vsAnybody = this.root.querySelector('INPUT[name=vs][value=anybody').checked;
    const vsYourself = this.root.querySelector('INPUT[name=vs][value=yourself').checked;
    const vsShareLink = this.root.querySelector('INPUT[name=vs][value=invite').checked;
    const vsChallenge = this.root.querySelector('INPUT[name=vs][value=challenge]').checked;

    divSearch.parentNode.style.display = vsChallenge ? '' : 'none';

    this._setRadioState(radPractice, 'required', vsYourself);
    this._setRadioState(radTournament, 'disabled', vsYourself);
    this._setRadioState(radRandomSide, 'disabled', vsYourself || this.gameType.hasFixedPositions);

    const isPractice = radPractice.checked;

    this._setRadioState(radRated, 'disabled', !authClient.isVerified || isPractice || collection === 'private');
    this._setRadioState(radUnrated, 'required', !authClient.isVerified || isPractice || collection === 'private');

    this.root.querySelectorAll('INPUT[name=slot]').forEach(e => this._setRadioState(e, 'disabled', !isPractice));
    this.root.querySelectorAll('INPUT[name=as]').forEach(rad => {
      rad.disabled = vsYourself;
    });
    this.root.querySelectorAll('INPUT[name=timeLimitName]').forEach(rad => {
      rad.disabled = vsYourself;
    });

    const styleConfigData = this._compileStyleConfig(true);
    if (styleConfigData)
      this.styleConfigData = styleConfigData;

    this.root.querySelector('.remember').classList.toggle('saved', (() => {
      if (!styleConfig.isDefault(this.data.gameTypeId))
        return false;
      if (!styleConfigData)
        return false;

      const fromStyleConfig = styleConfig.get(this.data.gameTypeId);
      for (const [ k, v ] of Object.entries(styleConfigData))
        // Only evaluate short & long time limit names
        if (k !== 'timeLimitName' && fromStyleConfig[k] !== v)
          return false;

      return true;
    })());

    if (this.data.view === 'createGame') {
      if (vsYourself)
        btnSubmit.textContent = 'Start Playing';
      else if (vsAnybody)
        btnSubmit.textContent = 'Create or Join Game';
      else if (vsShareLink)
        btnSubmit.textContent = 'Create Game Link';
      else if (vsChallenge && challengee.value && challengee.value.relationship?.type === 'blocked')
        btnSubmit.textContent = 'Unblock & Create Game';
      else
        btnSubmit.textContent = 'Create Game';
    } else if (this.data.view === 'forkGame') {
      btnSubmit.textContent = 'Fork Game';
    } else if (this.data.view === 'confirmBeforeCreate') {
      btnSubmit.textContent = 'Create Game';
    } else if (this.data.view === 'confirmBeforeJoin') {
      if (this.data.props.gameSummary.meta.creator.relationship.type === 'blocked')
        btnSubmit.textContent = 'Mute and Join Game';
      else
        btnSubmit.textContent = 'Join Game';
    } else if (this.data.view === 'challenge') {
      btnSubmit.textContent = 'Challenge';
    } else {
      btnSubmit.textContent = 'Done';
    }
  }

  async _onChangeSet() {
    if (this.data.changeInProgress)
      return;
    this.data.changeInProgress = true;
    await this.data.whenReady;

    const { selSet } = this._els;
    const setOption = selSet.querySelector(':checked');
    const setId = setOption.value;
    const setIndex = this.sets.findIndex(s => s.id === setId);
    const setBuilder = await Tactics.editSet({
      gameType: this.gameType,
      set: this.sets[setIndex],
    });
    const newSet = setBuilder.set;

    if (newSet.units.length > 0) {
      this.sets[setIndex] = newSet;
      setOption.textContent = this.sets[setIndex].name;
    } else {
      this.sets.splice(setIndex, 1);
      setOption.style.display = 'none';
      selSet.selectedIndex = 0;
    }

    this.data.changeInProgress = false;
  }

  _showGeneralStyleInfo() {
    popup({
      title: 'Choosing Your Style',
      message: `
        Every style has different requirements on what sets you may use when
        playing a game in that style.  The word "set" is used to describe what
        units are on your team and where they are placed at the beginning of a
        game.  Some styles like "Classic" may not allow you to customize your
        set while most styles allow customization with various restrictions.
      `,
      maxWidth: '500px',
    });
  }
  async _showStyleInfo() {
    if (this.data.infoInProgress)
      return;
    this.data.infoInProgress = true;
    await this.data.whenReady;

    popup({
      title: `${this.gameType.name} Style`,
      message: this.gameType.description,
      maxWidth: '500px',
    });

    this.data.infoInProgress = false;
  }
  _showCollectionInfo() {
    popup({
      title: 'Choosing Game Visibility',
      message: `
        <P>Only <B>Public</B> games can be rated or joined by other players
        without being invited.  Observers may find and watch the game while it
        is in progress or after it ends.</P>

        <P>People can only find <B>Private</B> games if they are invited.
        You can even play a private game against yourself.</P>
      `,
      maxWidth: '500px',
    });
  }
  _showVSInfo() {
    popup({
      title: 'Choosing Your Opponent',
      message: `
        <UL class="info">
          <LI><B>Public</B> games against <B>Anybody</B> may be automatically
          matched to other open public games or otherwise found and joined by
          other players.</LI>

          <LI><B>Private</B> games against <B>Yourself</B> is a great way to
          explore how the game is played.  You have full control over the sets
          and sides for the two opposing teams so that you may practice common
          openings.</LI>

          <LI>The <B>Share Link</B> option grants you more control over who may
          join your game.  You can even share a link with a friend that has never
          played the game before to help them get started.</LI>

          <LI><B>Challenge</B> a rated player by searching for their name.  The
          game will show up in their game list but won't begin until they accept.
          They may choose to reject the game.</LI>
        </UL>
      `,
      maxWidth: '500px',
    });
  }
  _showSetInfo() {
    popup({
      title: 'Choosing Your Set(up)',
      message: `
        Most game styles let you define up to 4 sets where you can customize
        what units are placed where.  You can do that by clicking the
        <B>Setup</B> button after choosing the style of interest in the lobby.
        Once you do, all of your sets for the selected game style will appear in
        the list.  Until then, you may still change the <B>Default</B> set via
        the <B>Change Set</B> link.  If you only see a <B>View Set</B> link, the
        selected game style does not allow custom sets.
      `,
      maxWidth: '500px',
    });
  }
  _showTimeLimitNameInfo() {
    popup({
      title: 'Turn Time Limits',
      message: `
        <UL class="info">
          <LI><B>Long</B> turn time limits enable correspondance games that can
          be played over the course of days or weeks.  You may take a full day
          or week to play a single turn.  When playing <B>Anybody</B> the open
          game can be found on the <B>Public</B> tab.</LI>
          <LI><B>Short</B> turn time limits are meant to be played in a single
          session and can take over an hour to play. When playing <B>Anybody</B>
          the open game can be found on the <B>Lobby</B> tab.  The first turn
          provides extra time to allow players to realize the game has started.
          If you are hosting a lobby game, you should check in within 5 minutes
          (2 minutes for <B>Blitz</B> games) to notice people joining your game
          and prevent your game from being cancelled due to inactivity.  If you
          enable push notifications, this inactivity timeout is raised to 1
          hour.</LI>
          <LI>The <B>Pro</B> option is meant to be played by experienced players
          since the time limit is shorter than the <B>Standard</B> time limit if
          you use all of your time every turn.  But if you play quickly enough,
          you can build up your time limit to a maximum of 6 minutes so that you
          can use that time to plan ahead or navigate difficult situations.</LI>
          <LI>The <B>Standard</B> option matches the original game where you
          start with 2 minutes and it decreases to 1 minute as units die.</LI>
          <LI>The <B>Blitz</B> option is the shortest time limit with a minimum
          of 30 seconds, but increases to a maximum of 2.5 minutes if you finish
          your turns within 15 seconds.  The time limit is reset to 30 seconds
          if you exceed 30 seconds in your turn.  You may only undo a single
          action within 5 seconds so that you can correct misclicks.  Otherwise,
          undo is unavailable.</LI>
        </UL>
      `,
      maxWidth: '500px',
    });
  }
  _showCustomizeInfo() {
    popup({
      message: `
        <UL class="info">
          <LI><B>Random Side</B> will flip your set horizontally for half of
          your games.  This helps prevent other players from countering you with
          sets that specialize in taking down your sets.  Not available for all
          styles.</LI>
          <LI><B>No Luck</B> removes random chance from blockable attacks.  This
          allows you to look at a unit on the board and learn whether it will
          block a front or side attack before it happens.</LI>
          <LI><B>Rated / Unrated</B> allows you to decide before the game starts
          whether the game will affect your rating.  A <B>Rated</B> game may
          prevent other players from joining your game if they are guests or
          have played you twice in a given style in the past week.  Guest
          accounts cannot play rated games.</LI>
          <LI><B>Tournament</B> games severely restrict your ability to undo and
          also prevents you from forking the game while it is in progress.</LI>
          <LI><B>Practice</B> games can't be rated and will also not affect your
          Win/Lose/Draw stats against a given player.  Undo use is also greatly
          relaxed such that you can rewrite history infinitely to try different
          paths in the name of science.</LI>
          <LI><B>1st / 2nd Turn</B> is usually decided randomly, but can be set
          up front in <B>Practice</B> games to help you explore different
          openings when you have 1st turn vs when you have 2nd.</LI>
        </UL>
      `,
      maxWidth: '500px',
    });
  }

  async setGameType(gameTypeId = null) {
    gameTypeId ??= styleConfig.getDefault();

    return this.data.whenReady = this.data.whenReady.then(async () => {
      this.data.gameTypeId = gameTypeId;

      if (!cache.has(gameTypeId)) {
        const config = styleConfig.get(gameTypeId);
        const [ gameType, sets ] = await Promise.all([
          gameClient.getGameType(gameTypeId),
          gameClient.getPlayerSets(gameTypeId),
        ]);
        if (config.set !== 'default' && config.set !== 'random' && !sets.some(s => s.id === config.set))
          config.set = 'default';

        cache.set(gameTypeId, { gameType, sets, config });
      } else {
        // Refresh sets just in case they have changed
        this.sets = await gameClient.getPlayerSets(gameTypeId);
      }
    });
  }
  async _applyStyleConfig() {
    const gameType = this.gameType;
    const sets = this.sets;
    const config = this.styleConfigData;
    const { aChangeLink, selSet } = this._els;

    selSet.querySelector('OPTION[value=same]').style.display = 'none';
    selSet.querySelector('OPTION[value=mirror]').style.display = 'none';
    this._els.set.style.display = '';
    this._els.customize.style.display = '';
    this._els.remember.style.display = '';
    this._els.buttons.style.justifyContent = '';

    if (this.data.view === 'confirmBeforeJoin') {
      const gs = this.data.props.gameSummary;
      const creatorIndex = gs.teams.findIndex(t => t?.playerId === gs.createdBy);
      const ranks = gs.meta.ranks[creatorIndex];
      const messages = [];
      const ratedMessage = await (async () => {
        if (gs.meta.rated)
          return `This will be a rated game.`;

        let reason;
        if (gs.mode === 'fork') {
          const gameData = await gameClient.getGameData(gs.id);
          const forkOf = gameData.forkOf;
          const playerIds = new Set(gameData.state.teams.map(t => t.forkOf.playerId));
          const of = playerIds.size === 1 ? 'single player game' : 'game';

          reason =
            `this game is a fork of <A href="/game.html?${forkOf.gameId}#c=${forkOf.turnId},0" target="_blank">that ${of}</A>`;

          const getName = team => {
            if (team.forkOf.playerId === team.playerId)
              return team.playerId === authClient.playerId ? 'yourself' : 'themself';
            if (team.forkOf.name && gameData.state.teams.filter(t => t.forkOf.name === team.forkOf.name).length === 1)
              return team.name;
            // This color moniker can be wrong in cases where the player participated in the origin game.
            // This is due to how the Game class rotates the board.
            return gameConfig.getTeamColorId(team);
          };
          const theirTeam = gameData.state.teams.find(t => !!t.joinedAt);
          const theirName = getName(theirTeam);
          const yourTeam = gameData.state.teams.find(t => !t.joinedAt);
          const yourName = getName(yourTeam);

          messages.push(`They will play as ${theirName}.`);
          messages.push(`You will play as ${yourName}.`);
        } else if (!authClient.isVerified)
          reason = `you are a guest`;
        else if (!ranks)
          reason = `they are a guest`;
        else
          switch (gs.meta.unratedReason) {
            case 'not rated':
              reason = `they want an unrated game`;
              break;
            case 'same identity':
              reason = `you can't play yourself in a rated game`;
              break;
            case 'in game':
              reason = `you are already playing a rated game against this player in this style`;
              break;
            case 'too many games':
              reason = `you have 2 rated games against this player in this style within the past week`;
              break;
            default:
              reason = `of a bug`;
          }

        return `This will not be a rated game because ${reason}.`;
      })();

      if (gs.mode === 'fork') {
        this._els.set.style.display = 'none';
        this._els.customize.style.display = 'none';
        this._els.remember.style.display = 'none';
        this._els.buttons.style.justifyContent = 'end';
      } else {
        if (gs.meta.creator.relationship.type)
          messages.push(`You ${gs.meta.creator.relationship.type} this player as ${gs.meta.creator.relationship.name}.`);

        messages.push(`They created their account ${getElapsed(gs.meta.creator.createdAt)} ago.`);

        if (ranks) {
          const forteRank = ranks.find(r => r.rankingId === 'FORTE');
          const styleRank = ranks.find(r => r.rankingId === this.gameTypeId);
          const provisional = styleRank && styleRank.gameCount < 10 ? ' provisional' : '';

          if (forteRank)
            messages.push(`They have Forte rank #${forteRank.num} (${forteRank.rating}).`);
          if (styleRank)
            messages.push(`They have${provisional} style rank #${styleRank.num} (${styleRank.rating}).`);
          else
            messages.push(`They are unranked in this style.`);
        }

        if (gs.mode === 'practice') {
          selSet.querySelector('OPTION[value=same]').style.display = '';
          selSet.querySelector('OPTION[value=mirror]').style.display = '';
        }
      }

      this.root.querySelector('.intro').innerHTML = `
        <DIV>${ratedMessage}</DIV>
        ${ messages.length ? `<DIV>${messages.join('<BR>')}</DIV>` : '' }
      `;
    } else if (this.data.view === 'forkGame') {
      const game = this.data.props.game;
      const forkOf = game.state.forkOf;
      const turnNumber = game.turnId + 1;
      const messages = [];

      if (forkOf) {
        const of = game.ofSinglePlayer ? 'single player game' : 'game';

        messages.push(`
          This game is a fork of <A href="/game.html?${forkOf.gameId}#c=${forkOf.turnId},0" target="_blank">that ${of}</A>.
        `);
      }

      messages.push(`
        You are about to create a game playable from the beginning of turn ${turnNumber}.
        ${ inApp ? '' : 'It will be opened in a new tab or window.' }
      `);

      this.root.querySelector('.intro').innerHTML = messages.map(m => `<DIV>${m}</DIV>`).join('');

      const myTeamIndex = game.teams.findIndex(t => game.isMyTeam(t));
      const as = myTeamIndex === -1 ? 0 : myTeamIndex;
      const divAs = this.root.querySelector('.as .indent');
      divAs.innerHTML = '';

      for (const team of game.teams) {
        let teamMoniker;
        if (team.name && game.teams.filter(t => t.name === team.name).length === 1)
          teamMoniker = team.name;
        else
          teamMoniker = team.colorId;

        const label = document.createElement('LABEL');
        label.innerHTML = `
          <INPUT
            type="radio"
            name="as"
            value="${team.id}"
            ${as === team.id ? 'checked' : ''}
          >
          ${teamMoniker}
        `;

        divAs.appendChild(label);
      }
    } else {
      this.root.querySelector('.intro').innerHTML = '';
    }

    if (sets.length === 1 && config.set === 'random')
      config.set = sets[0].id;

    if (config.set === 'random')
      aChangeLink.style.display = 'none';
    else {
      aChangeLink.style.display = '';
      if (gameType.isCustomizable)
        aChangeLink.textContent = 'Change Set';
      else
        aChangeLink.textContent = 'View Set';
    }

    for (const setId of gameConfig.setsById.keys()) {
      const setOption = selSet.querySelector(`OPTION[value="${setId}"]`);
      const set = sets.find(s => s.id === setId);
      if (set) {
        setOption.textContent = set.name;
        setOption.style.display = '';
      } else {
        setOption.style.display = 'none';
        setOption.textContent = gameConfig.setsById.get(setId);
      }
    }

    const selectedSetOption = selSet.querySelector(`OPTION[value="${config.set}"]`);
    if (selectedSetOption.style.display === 'none')
      config.set = 'default';

    Object.assign(config, this.styleConfigOverrides);

    const opponent = await authClient.getRatedPlayer(config.challengee);
    if (opponent && opponent.relationship?.type !== 'self') {
      config.vs = 'challenge';
      challengee.inputValue = opponent.name;
      challengee.value = opponent;
    } else if (config.vs === 'challenge') {
      config.vs = 'invite';
      challengee.inputValue = '';
      challengee.value = null;
    }

    const timeLimitName = this.data.timeLimitType ? config[`${this.data.timeLimitType}TimeLimitName`] : config.timeLimitName;

    try {
      this.root.querySelector('SELECT[name=type]').value = config.gameTypeId;
      this.root.querySelector(`INPUT[name=collection][value=${config.collection}]`).checked = true;
      this.root.querySelector(`INPUT[name=vs][value=${config.vs}`).checked = true;
      selSet.value = config.set;
      this.root.querySelector(`INPUT[name=timeLimitName][value=${timeLimitName}]`).checked = true;
    } catch (e) {
      report({
        type: 'debug',
        error: e,
        message: `timeLimitName is mysteriously falsey`,
        view: this.data.view,
        gameTypeId: this.data.gameTypeId,
        timeLimitType: this.data.timeLimitType,
        timeLimitName,
        savedConfig: styleConfig.get(this.data.gameTypeId),
        cachedConfig: cache.get(this.data.gameTypeId).config,
        adjustedConfig: config,
      });
    }

    this._setRadioState(this.root.querySelector('INPUT[name=randomSide]'), 'selected', config.randomSide);
    this._setRadioState(this.root.querySelector('INPUT[name=randomHitChance'), 'selected', !config.randomHitChance);
    this._setRadioState(this.root.querySelector('INPUT[name=rated][value=true]'), 'selected', config.rated === true);
    this._setRadioState(this.root.querySelector('INPUT[name=rated][value=false]'), 'selected', config.rated === false);
    this._setRadioState(this.root.querySelector('INPUT[name=rules][value=tournament]'), 'selected', config.rules === 'tournament');
    this._setRadioState(this.root.querySelector('INPUT[name=rules][value=practice]'), 'selected', config.rules === 'practice');
    this._setRadioState(this.root.querySelector('INPUT[name=slot][value="1"]'), 'selected', config.slot === 1);
    this._setRadioState(this.root.querySelector('INPUT[name=slot][value="0"]'), 'selected', config.slot === 0);

    return this._toggleFields();
  }
  _compileStyleConfig(silent = false) {
    const { divSearch } = this._els;
    const gameTypeId = this.root.querySelector('SELECT[name=type]').value;
    const collection = this.root.querySelector('INPUT[name=collection]:checked').value;
    const vs = this.root.querySelector('INPUT[name=vs]:checked').value;
    const set = this.root.querySelector('SELECT[name=set]').value;
    const timeLimitName = this.root.querySelector('INPUT[name=timeLimitName]:checked:not(:disabled)')?.value ?? null;
    const randomHitChance = this.root.querySelector('INPUT[name=randomHitChance]:checked')?.value ?? 'true';
    const slot = this.root.querySelector('INPUT[name=slot]:checked')?.value ?? 'random';
    const randomSide = this.root.querySelector('INPUT[name=randomSide]:checked:not(:disabled)')?.value ?? 'false';
    const rated = this.root.querySelector('LABEL.selected INPUT[name=rated]:checked')?.value ?? 'auto';
    const rules = this.root.querySelector('LABEL.selected INPUT[name=rules]:checked')?.value ?? null;
    const styleConfigData = {
      gameTypeId,
      collection,
      vs,
      set,
      timeLimitName,
      shortTimeLimitName:
        [ 'pro', 'standard', 'blitz' ].includes(timeLimitName) ? timeLimitName : this.styleConfigData.shortTimeLimitName,
      longTimeLimitName:
        [ 'week', 'day' ].includes(timeLimitName) ? timeLimitName : this.styleConfigData.longTimeLimitName,
      randomHitChance: randomHitChance === 'true',
      slot: slot === 'random' ? 'random' : parseInt(slot),
      randomSide: randomSide === 'true',
      rated: rated === 'auto' ? null : rated === 'true',
      rules,
      challengee: null,
    };

    if (vs === 'challenge') {
      if (challengee.value === null) {
        if (!silent)
          throw new ServerError(400, 'First choose who you wish to challenge.');
        return null;
      }

      styleConfigData.challengee = challengee.value.playerId;
    }

    for (const key of Object.keys(this.styleConfigOverrides))
      delete styleConfigData[key];

    return styleConfigData;
  }

  _saveStyleConfig() {
    let styleConfigData;

    try {
      styleConfigData = this._compileStyleConfig();
    } catch (error) {
      this._showError(error.message);
      return;
    }

    this.styleConfigData = styleConfigData;
    styleConfig.save(styleConfigData);
    this._els.remember.classList.add('saved');
  }

  async _submit() {
    this._clearError();

    if (this.data.submitInProgress)
      return;
    this.data.submitInProgress = true;

    try {
      if (this.data.view === 'challenge')
        await this._submitCreateGame();
      else if (this.data.view === 'createGame')
        await this._submitCreateGame();
      else if (this.data.view === 'forkGame')
        await this._submitForkGame();
      else if (this.data.view === 'confirmBeforeCreate')
        await this._submitConfirmBeforeCreate();
      else if (this.data.view === 'confirmBeforeJoin')
        await this._submitConfirmBeforeJoin();
    } catch (error) {
      if (error.code === 404) {
        popup('Oops!  The game disappeared.');
        this.hide();
      } else if (error.code === 409) {
        if (error.message.startsWith('Too many active'))
          popup('Oops!  You already have an active lobby game!');
        else if (error.message.startsWith('Too many open'))
          popup('Oops!  You already have an open lobby game in this style!');
        else
          popup('Oops!  Somebody else jumped this game first.');
        this.hide();
      } else if (error.code === 412) {
        this.setGameType(this.data.gameTypeId).then(() => this._applyStyleConfig());
        this._showError('Error: '+error.message);
      } else if (error.code)
        this._showError('Error: '+error.message);
      else {
        console.error(error);
        this._showError('Unexpected client-side error');
      }

      // Log client-side errors
      if (!error.code)
        throw error;
      return;
    } finally {
      this.hideMessage();
      this.data.submitInProgress = false;
    }

    return this.hide();
  }

  async _submitCreateGame() {
    await this.data.whenReady;

    this._compileStyleConfig();

    const styleConfigData = this.adjustedStyleConfig;
    const gameTypeId = this.data.gameTypeId;
    const gameOptionsData = this.createGameOptions();
    const youSlot = gameOptionsData.teams.findIndex(t => t?.playerId === authClient.playerId && t.set);
    const youTeam = gameOptionsData.teams[youSlot];
    const themSlot = (youSlot + 1) % 2;
    const themTeam = gameOptionsData.teams[themSlot];

    this.showMessage('Please wait while we create or join a game...');

    let myGameQuery;
    let matchingGameQuery;
    let joinQuery;
    if ([ 'anybody', 'challenge' ].includes(styleConfigData.vs)) {
      const excludedPlayerIds = new Set();

      if (authClient.playerId) {
        // Do not join my own waiting games.
        excludedPlayerIds.add(authClient.playerId);

        try {
          // Do not join waiting games against players we are already playing.
          const result = await gameClient.searchMyGames({
            filter: {
              // Game type must match player preference.
              type: gameTypeId,
              startedAt: { not:null },
              endedAt: null,
            },
            sort: { field:'createdAt', order:'desc' },
            limit: 50,
          });

          result.hits.forEach(g => {
            const team = g.teams.find(t => t.playerId !== authClient.playerId);
            if (team)
              excludedPlayerIds.add(team.playerId);
          });
        } catch (e) {
          console.error(e);
        }

        // Prevent duplicates by looking for an identical open game.
        myGameQuery = {
          filter: {
            // Ignore challenges created by others
            createdBy: authClient.playerId,
            startedAt: null,
            collection: gameOptionsData.collection,
            type: gameTypeId,
            mode: styleConfigData.rules,
            timeLimitName: gameOptionsData.timeLimitName,
            randomFirstTurn: gameOptionsData.randomFirstTurn,
            randomHitChance: gameOptionsData.randomHitChance,
            rated: gameOptionsData.rated,
          },
          sort: 'createdAt',
          limit: 1,
        };

        // Cancel and recreate similar open games created by this player.
        matchingGameQuery = {
          filter: {
            // Ignore challenges created by others
            createdBy: authClient.playerId,
            startedAt: null,
            collection: gameOptionsData.collection,
            type: gameTypeId,
          },
          sort: 'createdAt',
          limit: 1,
        };

        if (styleConfigData.vs === 'anybody') {
          myGameQuery.filter['$.teams'] = { includes:null };
          matchingGameQuery.filter['$.teams'] = { includes:null };
        } else if (styleConfigData.vs === 'challenge') {
          myGameQuery.filter['$.teams[*].playerId'] = { includes:themTeam.playerId };
          matchingGameQuery.filter['$.teams[*].playerId'] = { includes:themTeam.playerId };
          // Only one challenge per style per player regardless of collection.
          delete matchingGameQuery.filter.collection;
        }
      }

      joinQuery = {
        filter: {
          startedAt: null,
          collection: gameOptionsData.collection,
          type: gameTypeId,
          mode: styleConfigData.rules,
          timeLimitName: gameOptionsData.timeLimitName,
          randomFirstTurn: gameOptionsData.randomFirstTurn,
          randomHitChance: gameOptionsData.randomHitChance,
        },
        metaFilter: {
          // Ignore games where we do not meet their rated requirements
          $: { not:{ nested:{ rated:true, 'meta.rated':false } } },
          // Ignore games created by players we blocked
          'meta.creator.relationship.type': { not:'blocked' },
        },
        sort: 'createdAt',
        // We only need one, but use of 'metaFilter' encourages a higher limit
        limit: 50,
      };
      if (gameOptionsData.rated !== null) {
        // Find games that meet our rated requirements.
        joinQuery.filter.rated = { not:!gameOptionsData.rated };
        joinQuery.metaFilter['meta.rated'] = gameOptionsData.rated;
      }

      if (styleConfigData.vs === 'challenge') {
        joinQuery.filter.createdBy = themTeam.playerId;

        if (gameOptionsData.randomFirstTurn === false)
          joinQuery.filter['$.teams[*].playerId'] = { is:gameOptionsData.teams.map(t => t.playerId) };
      } else {
        // Don't join open games against disqualified players
        joinQuery.filter['$.teams[*].playerId'] = { not:{ intersects:[ ...excludedPlayerIds ] } };

        if (gameOptionsData.randomFirstTurn === false)
          // My desired slot must be available
          joinQuery.filter[`teams[${youSlot}]`] = null;
      }
    }

    const gameId = await Promise.resolve().then(async () => {
      let gameId;

      if (styleConfigData.vs === 'anybody') {
        gameId = await joinOpenGame(gameOptionsData.collection, joinQuery, youTeam);
        if (gameId) {
          popup('Joined a matching game!');
          return gameId;
        }
      } else {
        gameId = await acceptChallenge(joinQuery, youTeam);
        if (gameId) {
          popup('Accepted matching challenge!');
          return gameId;
        }
      }

      if (myGameQuery) {
        const result = await gameClient.searchMyGames(myGameQuery);
        if (result.count) {
          if (styleConfigData.vs === 'challenge')
            throw new ServerError(400, 'Challenge already exists!');
          else
            throw new ServerError(400, 'Game already exists!');
        }
      }

      let didReplace = false;
      if (matchingGameQuery) {
        const result = await gameClient.searchMyGames(matchingGameQuery);
        if (result.count) {
          gameClient.cancelGame(result.hits[0].id);
          didReplace = true;
        }
      }

      gameId = await gameClient.createGame(gameTypeId, gameOptionsData);
      if (styleConfigData.vs === 'challenge') {
        if (didReplace)
          popup('Matching challenge replaced!');
        else
          popup('Challenge sent!');
      } else {
        if (didReplace)
          popup('Matching game replaced!');
        else if (styleConfigData.vs === 'yourself')
          popup({ message:'Please wait!', buttons:[], closeOnCancel:false });
        else
          popup('Game created!');
      }

      return gameId;
    });

    if (styleConfigData.vs === 'yourself')
      location.href = `game.html?${gameId}`;
  }
  async _submitForkGame() {
    const game = this.data.props.game;
    const styleConfigData = this._compileStyleConfig();
    const vs = styleConfigData.vs;
    const as = this.root.querySelector('INPUT[name=as]:checked').value;

    const newGameId = await Tactics.gameClient.forkGame(game.id, {
      turnId: game.turnId,
      vs: vs === 'challenge' ? styleConfigData.challengee : vs,
      as: vs === 'yourself' ? undefined : parseInt(as),
      timeLimitName: vs === 'yourself' ? undefined : styleConfigData.timeLimitName,
    });

    const target = inApp ? window : window.open();
    if (target === null) {
      popup({
        message: `Your fork game is ready.`,
        buttons: [
          { label:'Open Now', onClick:() => {
            const target = inApp ? window : window.open();
            target.location.href = `/game.html?${newGameId}`;
          } },
          { label:'Open Later' },
        ],
      });
    } else {
      target.location.href = `/game.html?${newGameId}`;
    }
  }

  _submitConfirmBeforeCreate() {
    this._compileStyleConfig();

    return gameClient.createGame(this.data.gameTypeId, {
      ...this.createGameOptions(),
      tags: {
        arenaIndex: this.data.props.arenaIndex,
      },
    });
  }
  _submitConfirmBeforeJoin() {
    this._compileStyleConfig();

    return gameClient.joinGame(this.data.props.gameSummary.id, this.joinGameOptions());
  }

  showMessage(message) {
    this.root.classList.add('message-only');
    this._els.divMessage.innerHTML = message;
  }
  hideMessage() {
    this.root.classList.remove('message-only');
    if (!this._els.divMessage.classList.contains('error'))
      this._els.divMessage.innerHTML = '';
  }

  _showError(message) {
    this._els.divMessage.classList.add('error');
    this._els.divMessage.innerHTML = message;
  }
  _clearError() {
    this._els.divMessage.classList.remove('error');
    this._els.divMessage.innerHTML = '';
  }
}

async function joinOpenGame(collection, query, youTeam) {
  if (!query) return;

  let gameSummary;

  try {
    const result = await gameClient.searchGameCollection(collection, query);
    if (!result.count) return;

    const gameSummary = result.hits[0];

    await gameClient.joinGame(gameSummary.id, {
      name: teamName.value,
      set: youTeam.set,
      randomSide: youTeam.randomSide,
    });

    return gameSummary.id;
  } catch (error) {
    if (error.code === 409)
      if (error.message === 'Already joined this game')
        // Open the already joined game (shouldn't happen)
        return gameSummary.id;
      else if (error.message === 'Too many open or active lobby games.')
        // Give up trying to join a game.  Creating a game will fail more visibly.
        return;
      else
        // Try again when somebody else beats us to joining the game
        return joinOpenGame(collection, query, youTeam);

    // On any other error, bail out to create the game.
    reportError(error);
    return;
  }
}

async function acceptChallenge(query, youTeam) {
  if (!query) return;

  let gameSummary;

  try {
    const result = await gameClient.searchMyGames(query);
    if (!result.count) return;

    const hits = result.hits.filter(h => h.meta.creator.relationship?.type !== 'blocked');
    if (!hits.length) return;

    gameSummary = hits[0];
    await gameClient.joinGame(gameSummary.id, {
      name: teamName.value,
      set: youTeam.set,
      randomSide: youTeam.randomSide,
    });

    return gameSummary.id;
  } catch (error) {
    if (error.code === 409)
      if (error.message === 'Already joined this game')
        // Open the already joined game (shouldn't happen)
        return gameSummary.id;
      else
        // Try again when somebody else beats us to joining the game
        return acceptChallenge(query, youTeam);

    // On any other error, bail out to create the game.
    reportError(error);
    return;
  }
}

function getElapsed(date) {
  if (typeof date === 'string')
    date = new Date(date);

  const diff = (Date.now() - date) / 1000;

  let elapsed;
  if (diff > 86400)
    elapsed = `${Math.floor(diff / 86400)} day(s)`;
  else if (diff > 3600)
    elapsed = `${Math.floor(diff / 3600)} hour(s)`;
  else if (diff > 60)
    elapsed = `${Math.floor(diff / 60)} minute(s)`;
  else
    elapsed = `seconds`;

  return elapsed;
}
