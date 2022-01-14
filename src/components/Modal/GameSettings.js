import 'components/Modal/GameSettings.scss';
import Modal from 'components/Modal.js';
import fullscreen from 'components/fullscreen.js';

export default class GameSettings extends Modal {
  constructor(data, options = {}) {
    const forkOf = data.game.state.forkOf;
    let fork = '';
    if (forkOf) {
      let of = game.ofPracticeGame ? 'practice game' : 'game';

      fork = `
        <DIV class="fork">
          This game is a fork of <A href="/game.html?${forkOf.gameId}#c=${forkOf.turnId},0" target="_blank">that ${of}</A>.
        </DIV>
      `;
    }

    const timeLimit = data.game.state.turnTimeLimit;
    const timeLimitLabel =
      timeLimit === 30 ? 'Blitz' :
      timeLimit === 120 ? 'Standard' :
      timeLimit === 86400 ? '1 Day' :
      timeLimit === 604800 ? '1 Week' : 'None';

    options.title = 'Game Settings';
    options.content = `
      ${fork}
      <DIV class="info">
        <DIV>Game Style: ${data.gameType.name}</DIV>
        <DIV>Blocking System: ${data.game.state.randomHitChance ? 'Random (Luck)' : 'Predictable (No Luck)'}</DIV>
        <DIV>Turn Time Limit: ${timeLimitLabel}</DIV>
      </DIV>
      <DIV class="settings">
        <DIV class="row audio">
          <DIV class="label">Audio</DIV>
          <LABEL><INPUT type="radio" name="audio" value="on"> On</LABEL>
          <LABEL><INPUT type="radio" name="audio" value="off"> Off</LABEL>
        </DIV>
        <DIV class="row gameSpeed">
          <DIV class="label">Game Speed</DIV>
          <LABEL><INPUT type="radio" name="gameSpeed" value="auto"> Auto</LABEL>
          <LABEL><INPUT type="radio" name="gameSpeed" value="2"> 2x</LABEL>
        </DIV>
        <DIV class="row fullscreen">
          <DIV class="label">Full Screen</DIV>
          <LABEL><INPUT type="radio" name="fullscreen" value="on"> On</LABEL>
          <LABEL><INPUT type="radio" name="fullscreen" value="off"> Off</LABEL>
        </DIV>
        <DIV class="row barPosition">
          <DIV class="label">Bar Position</DIV>
          <LABEL><INPUT type="radio" name="barPosition" value="left"> Left</LABEL>
          <LABEL><INPUT type="radio" name="barPosition" value="right"> Right</LABEL>
        </DIV>
      </DIV>
    `;

    super(options, data);

    this.els = {
      modal: this.el.querySelector('.modal'),
      audio: this.el.querySelector('.audio'),
      gameSpeed: this.el.querySelector('.gameSpeed'),
      fullscreen: this.el.querySelector('.fullscreen'),
      barPosition: this.el.querySelector('.barPosition'),
    };
    this.els.modal.classList.add('gameSettings');

    this.el.addEventListener('change', event => {
      switch (event.target.name) {
        case 'audio':
          this.toggleAudio();
          break;
        case 'gameSpeed':
          this.setGameSpeed(event.target.value);
          break;
        case 'fullscreen':
          this.toggleFullscreen();
          break;
        case 'barPosition':
          this.toggleBarPosition();
          break;
      }
    }, true);

    if (Howler.noAudio)
      this.els.audio.style.display = 'none';
    if (!fullscreen.isAvailable())
      this.els.fullscreen.style.display = 'none';

    this.restore();
    this.detectSettings();

    this._resizeListener = event => this.detectSettings();
    window.addEventListener('resize', this._resizeListener);
  }

  detectSettings() {
    let app = document.querySelector('#app');
    let settings = this.data.settings;

    settings.fullscreen = fullscreen.isEnabled();

    if (settings.audio)
      this.el.querySelector('INPUT[name=audio][value=on]').checked = true;
    else
      this.el.querySelector('INPUT[name=audio][value=off]').checked = true;

    if (settings.gameSpeed === 'auto')
      this.el.querySelector('INPUT[name=gameSpeed][value=auto]').checked = true;
    else
      this.el.querySelector('INPUT[name=gameSpeed][value="2"]').checked = true;

    if (settings.fullscreen)
      this.el.querySelector('INPUT[name=fullscreen][value=on]').checked = true;
    else
      this.el.querySelector('INPUT[name=fullscreen][value=off]').checked = true;

    if (settings.barPosition === 'left')
      this.el.querySelector('INPUT[name=barPosition][value=left]').checked = true;
    else
      this.el.querySelector('INPUT[name=barPosition][value=right]').checked = true;
  }

  toggleAudio() {
    this.data.settings.audio = !this.data.settings.audio;
    this.save();

    Howler.mute(!this.data.settings.audio);
  }

  setGameSpeed(gameSpeed) {
    this.data.settings.gameSpeed = gameSpeed;
    this.save();

    if (gameSpeed === 'auto')
      this.data.game.speed = gameSpeed;
    else
      this.data.game.speed = parseInt(gameSpeed);
  }

  toggleFullscreen() {
    this.data.settings.fullscreen = !this.data.settings.fullscreen;

    fullscreen.toggle();
  }

  toggleBarPosition() {
    this.data.settings.barPosition = this.data.settings.barPosition === 'left' ? 'right' : 'left';
    this.save();

    let app = document.querySelector('#app');
    app.classList.toggle('left');
    app.classList.toggle('right');
  }

  save() {
    const thisSettings = this.data.settings;
    const settings = Object.assign(JSON.parse(localStorage.getItem('settings') ?? '{}'), {
      audio: thisSettings.audio,
      gameSpeed: thisSettings.gameSpeed,
      barPosition: thisSettings.barPosition,
    });

    localStorage.setItem('settings', JSON.stringify(settings));
  }
  restore() {
    let settings = localStorage.getItem('settings');

    if (settings) {
      settings = JSON.parse(settings);

      Howler.mute(!settings.audio);

      if (!settings.gameSpeed)
        settings.gameSpeed = 'auto';
      if (settings.gameSpeed === 'auto')
        this.data.game.speed = settings.gameSpeed;
      else
        this.data.game.speed = parseInt(settings.gameSpeed);

      let app = document.querySelector('#app');
      if (settings.barPosition === 'left') {
        app.classList.remove('left');
        app.classList.add('right');
      } else {
        app.classList.remove('right');
        app.classList.add('left');
      }
    } else {
      settings = {
        audio: !Howler._muted,
        gameSpeed: 'auto',
        barPosition: app.classList.contains('left') ? 'right' : 'left',
      };
    }

    this.data.settings = settings;
  }

  destroy() {
    super.destroy();
    window.removeEventListener('resize', this._resizeListener);
  }
}
