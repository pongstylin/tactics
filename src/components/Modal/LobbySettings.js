import 'components/Modal/LobbySettings.scss';
import { gameConfig } from 'config/client.js';
import Modal from 'components/Modal.js';

export default class LobbySettings extends Modal {
  constructor(options = {}) {
    options.title = 'Lobby Settings';
    options.content = `
      <DIV class="row audio">
        <DIV class="label">Audio</DIV>
        <LABEL><INPUT type="radio" name="audio" value="on"> On</LABEL>
        <LABEL><INPUT type="radio" name="audio" value="off"> Off</LABEL>
      </DIV>
      <DIV class="row barPosition">
        <DIV class="label">Bar Position</DIV>
        <LABEL><INPUT type="radio" name="barPosition" value="left"> Left</LABEL>
        <LABEL><INPUT type="radio" name="barPosition" value="right"> Right</LABEL>
      </DIV>
      <DIV class="row createBlocking">
        <DIV class="label">Blocking</DIV>
        <LABEL><INPUT type="radio" name="createBlocking" value="ask"> Ask</LABEL>
        <LABEL><INPUT type="radio" name="createBlocking" value="luck"> Luck</LABEL>
        <LABEL><INPUT type="radio" name="createBlocking" value="noluck"> No Luck</LABEL>
      </DIV>
      <DIV class="row createTimeLimit">
        <DIV class="label">Time Limit</DIV>
        <LABEL><INPUT type="radio" name="createTimeLimit" value="ask"> Ask</LABEL>
        <LABEL><INPUT type="radio" name="createTimeLimit" value="standard"> Standard</LABEL>
        <LABEL><INPUT type="radio" name="createTimeLimit" value="blitz"> Blitz</LABEL>
      </DIV>
      <DIV class="row set">
        <DIV class="label">Set</DIV>
        <LABEL><INPUT type="radio" name="set" value="ask"> Ask</LABEL>
        <LABEL><INPUT type="radio" name="set" value="default"> Default</LABEL>
        <LABEL><INPUT type="radio" name="set" value="random"> Random</LABEL>
      </DIV>
      <DIV class="row randomSide">
        <DIV class="label">Random Side</DIV>
        <LABEL><INPUT type="radio" name="randomSide" value="on"> On</LABEL>
        <LABEL><INPUT type="radio" name="randomSide" value="off"> Off</LABEL>
      </DIV>
    `;

    super(options);

    Object.assign(this._els, {
      audio: this.root.querySelector('.audio'),
    });
    this.root.classList.add('lobbySettings');

    this.root.addEventListener('change', event => {
      switch (event.target.name) {
        case 'audio':
          this.toggleAudio();
          break;
        case 'barPosition':
          this.toggleBarPosition();
          break;
        case 'createBlocking':
          this.setCreateBlocking(event.target.value);
          break;
        case 'createTimeLimit':
          this.setCreateTimeLimit(event.target.value);
          break;
        case 'set':
          this.setSet(event.target.value);
          break;
        case 'randomSide':
          this.toggleRandomSide();
          break;
      }
    }, true);

    if (Howler.noAudio)
      this._els.audio.style.display = 'none';

    this.restore();
    this.detectSettings();

    setTimeout(() => {
      this._emit({ type:'settings', data:this.data.settings });
    });
  }

  show() {
    if (Tactics.audioBroken)
      this._els.audio.classList.add('broken');

    super.show();
  }

  detectSettings() {
    const settings = this.data.settings;

    if (settings.audio)
      this.root.querySelector('INPUT[name=audio][value=on]').checked = true;
    else
      this.root.querySelector('INPUT[name=audio][value=off]').checked = true;

    this.root.querySelector(`INPUT[name=barPosition][value=${settings.barPosition}]`).checked = true;
    this.root.querySelector(`INPUT[name=createBlocking][value=${settings.createBlocking}]`).checked = true;
    this.root.querySelector(`INPUT[name=createTimeLimit][value=${settings.createTimeLimit}]`).checked = true;
    this.root.querySelector(`INPUT[name=set][value=${settings.set}]`).checked = true;

    if (settings.randomSide)
      this.root.querySelector('INPUT[name=randomSide][value=on]').checked = true;
    else
      this.root.querySelector('INPUT[name=randomSide][value=off]').checked = true;
  }

  toggleAudio() {
    this.data.settings.audio = !this.data.settings.audio;
    gameConfig.audio = this.data.settings.audio;
    Howler.mute(!this.data.settings.audio);
  }
  toggleBarPosition() {
    this.data.settings.barPosition = this.data.settings.barPosition === 'left' ? 'right' : 'left';
    gameConfig.barPosition = this.data.settings.barPosition;
  }

  setCreateBlocking(value) {
    this.data.settings.createBlocking = value;
    gameConfig.blockingSystem = value;
  }
  setCreateTimeLimit(value) {
    this.data.settings.createTimeLimit = value;
    gameConfig.turnTimeLimit = value;
  }
  setSet(value) {
    this.data.settings.set = value;
    gameConfig.set = value;
  }

  toggleRandomSide() {
    this.data.settings.randomSide = !this.data.settings.randomSide;
    gameConfig.randomSide = this.data.settings.randomSide;
  }

  restore() {
    this.data.settings = {
      audio: gameConfig.audio,
      barPosition: gameConfig.barPosition,
      createBlocking: gameConfig.blockingSystem,
      createTimeLimit: gameConfig.turnTimeLimit,
      set: gameConfig.set,
      randomSide: gameConfig.randomSide,
    };
  }
}
