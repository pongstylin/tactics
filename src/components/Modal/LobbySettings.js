import 'components/Modal/LobbySettings.scss';
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
    `;

    super(options);

    this.els = {
      modal: this.el.querySelector('.modal'),
      audio: this.el.querySelector('.audio'),
      createBlocking: this.el.querySelector('.createBlocking'),
      createTimeLimit: this.el.querySelector('.createTimeLimit'),
    };
    this.els.modal.classList.add('lobbySettings');

    this.el.addEventListener('change', event => {
      switch (event.target.name) {
        case 'audio':
          this.toggleAudio();
          break;
        case 'labels':
          this.toggleLabels();
          break;
        case 'createBlocking':
          this.setCreateBlocking(event.target.value);
          break;
        case 'createTimeLimit':
          this.setCreateTimeLimit(event.target.value);
          break;
      }
    }, true);

    if (Howler.noAudio)
      this.els.audio.style.display = 'none';

    this.restore();
    this.detectSettings();

    setTimeout(() => {
      this._emit({ type:'settings', data:this.data.settings });
    });
  }

  detectSettings() {
    const settings = this.data.settings;

    if (settings.audio)
      this.el.querySelector('INPUT[name=audio][value=on]').checked = true;
    else
      this.el.querySelector('INPUT[name=audio][value=off]').checked = true;

    this.el.querySelector(`INPUT[name=createBlocking][value=${settings.createBlocking}]`).checked = true;
    this.el.querySelector(`INPUT[name=createTimeLimit][value=${settings.createTimeLimit}]`).checked = true;
  }

  toggleAudio() {
    this.data.settings.audio = !this.data.settings.audio;
    this.save();

    Howler.mute(!this.data.settings.audio);
  }
  toggleLabels() {
    this.data.settings.labels = !this.data.settings.labels;
    this.save();
  }

  setCreateBlocking(value) {
    this.data.settings.createBlocking = value;
    this.save();
  }
  setCreateTimeLimit(value) {
    this.data.settings.createTimeLimit = value;
    this.save();
  }

  save() {
    const thisSettings = this.data.settings;
    const settings = Object.assign(JSON.parse(localStorage.getItem('settings') ?? '{}'), {
      audio: thisSettings.audio,
      arenaLabels: thisSettings.labels,
      blockingSystem: thisSettings.createBlocking,
      turnTimeLimit: thisSettings.createTimeLimit,
    });

    localStorage.setItem('settings', JSON.stringify(settings));
  }
  restore() {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');

    this.data.settings = {
      audio: settings.audio ?? !Howler._muted,
      labels: settings.arenaLabels ?? false,
      createBlocking: settings.blockingSystem ?? 'luck',
      createTimeLimit: settings.turnTimeLimit ?? 'standard',
      filterBlocking: 'any',
      filterTimeLimit: 'any',
    };

    Howler.mute(!this.data.settings.audio);
  }
}
