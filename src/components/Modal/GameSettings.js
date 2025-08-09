import 'components/Modal/GameSettings.scss';
import { gameConfig } from 'config/client.js';
import Modal from 'components/Modal.js';
import fullscreen from 'components/fullscreen.js';

export default class GameSettings extends Modal {
  constructor(data, options = {}) {
    const forkOf = data.game.state.forkOf;
    let identity;
    if (forkOf) {
      const of = game.ofSinglePlayer ? 'single player game' : 'game';

      identity = `
        This game is a fork of <A href="/game.html?${forkOf.gameId}#c=${forkOf.turnId},0" target="_blank">that ${of}</A>.
      `;
    } else if (data.game.isBotGame) {
      identity = `This is an AI challenge.`;
    } else if (data.game.isPracticeMode) {
      identity = `This is a practice game.`;
    } else if (data.game.isLocalGame) {
      identity = `This is a local game.`;
    } else {
      const rated = data.game.state.rated ? 'a rated' : 'an unrated';
      let vs;
      if (data.game.state.strictFork)
        vs = 'Tournament';
      else if (data.game.collection === 'public')
        vs = 'Public';
      else if (data.game.collection)
        vs = 'Lobby';
      else
        vs = 'Private';

      identity = `This is ${rated} ${vs} game.`;
    }

    const timeLimitLabel = data.game.timeLimitName?.toUpperCase('first') ?? 'None';

    options.title = 'Game Settings';
    options.content = `
      <DIV class="identity">
        ${identity}
      </DIV>
      <DIV class="info">
        <DIV>Game Style: ${data.gameType.name}</DIV>
        <DIV>Time Limit: ${timeLimitLabel}</DIV>
        <DIV>Blocking System: ${data.game.state.randomHitChance ? 'Random (Luck)' : 'Predictable (No Luck)'}</DIV>
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

    Object.assign(this._els, {
      audio: this.root.querySelector('.audio'),
      gameSpeed: this.root.querySelector('.gameSpeed'),
      fullscreen: this.root.querySelector('.fullscreen'),
      barPosition: this.root.querySelector('.barPosition'),
    });
    this.root.classList.add('gameSettings');

    this.root.addEventListener('change', event => {
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
      this._els.audio.style.display = 'none';
    if (!fullscreen.isAvailable())
      this._els.fullscreen.style.display = 'none';

    this.restore();
    this.detectSettings();

    this._resizeListener = event => this.detectSettings();
    window.addEventListener('resize', this._resizeListener);
  }

  show() {
    if (Tactics.audioBroken)
      this._els.audio.classList.add('broken');

    super.show();
  }

  detectSettings() {
    const app = document.querySelector('#app');
    const settings = this.data.settings;

    if (settings.audio)
      this.root.querySelector('INPUT[name=audio][value=on]').checked = true;
    else
      this.root.querySelector('INPUT[name=audio][value=off]').checked = true;

    if (settings.gameSpeed === 'auto')
      this.root.querySelector('INPUT[name=gameSpeed][value=auto]').checked = true;
    else
      this.root.querySelector('INPUT[name=gameSpeed][value="2"]').checked = true;

    if (settings.fullscreen)
      this.root.querySelector('INPUT[name=fullscreen][value=on]').checked = true;
    else
      this.root.querySelector('INPUT[name=fullscreen][value=off]').checked = true;

    if (settings.barPosition === 'left')
      this.root.querySelector('INPUT[name=barPosition][value=left]').checked = true;
    else
      this.root.querySelector('INPUT[name=barPosition][value=right]').checked = true;
  }

  toggleAudio() {
    this.data.settings.audio = !this.data.settings.audio;
    gameConfig.audio = this.data.settings.audio;
    Howler.mute(!this.data.settings.audio);
  }

  setGameSpeed(gameSpeed) {
    if (gameSpeed === '2')
      gameSpeed = parseInt(gameSpeed);

    this.data.settings.gameSpeed = gameSpeed;
    gameConfig.gameSpeed = gameSpeed;

    this.data.game.speed = gameSpeed;
  }

  toggleFullscreen() {
    this.data.settings.fullscreen = !this.data.settings.fullscreen;

    fullscreen.toggle();
  }

  toggleBarPosition() {
    this.data.settings.barPosition = this.data.settings.barPosition === 'left' ? 'right' : 'left';
    gameConfig.barPosition = this.data.settings.barPosition;

    const app = document.querySelector('#app');
    app.classList.toggle('left');
    app.classList.toggle('right');
  }

  restore() {
    this.data.settings = {
      audio: gameConfig.audio,
      gameSpeed: gameConfig.gameSpeed,
      barPosition: gameConfig.barPosition,
      fullscreen: fullscreen.isEnabled(),
    };

    this.data.game.speed = this.data.settings.gameSpeed;

    const app = document.querySelector('#app');
    if (this.data.settings.barPosition === 'left') {
      app.classList.remove('left');
      app.classList.add('right');
    } else {
      app.classList.remove('right');
      app.classList.add('left');
    }
  }

  destroy() {
    super.destroy();
    window.removeEventListener('resize', this._resizeListener);
  }
}
