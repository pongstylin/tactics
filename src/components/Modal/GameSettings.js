import 'components/Modal/GameSettings.scss';
import Modal from 'components/Modal.js';
import popup from 'components/popup.js';
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

    const showLocalize = timeLimit !== 30 && 'localize' in data.game.state;

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
        <DIV class="row localize"${ showLocalize ? '' : ' style="display:none"' }>
          <DIV class="label">Localize Actions</DIV>
          <LABEL><INPUT type="radio" name="localize" value="on"> On</LABEL>
          <LABEL><INPUT type="radio" name="localize" value="off"> Off</LABEL>
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
      localized: this.el.querySelector('.localized'),
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
        case 'localize':
          this.setLocalize(event.target.value);
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

  show() {
    if (Tactics.audioBroken)
      this.els.audio.classList.add('broken');

    super.show();
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

    if (settings.localize)
      this.el.querySelector('INPUT[name=localize][value=on]').checked = true;
    else
      this.el.querySelector('INPUT[name=localize][value=off]').checked = true;

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
    if (gameSpeed === '2')
      gameSpeed = parseInt(gameSpeed);

    this.data.settings.gameSpeed = gameSpeed;
    this.save();

    this.data.game.speed = gameSpeed;
  }

  setLocalize(localize) {
    localize = localize === 'on';

    const doSetLocalize = () => {
      this.data.settings.localize = localize;
      this.save();

      this.data.game.state.localize = localize;
    };
    const cancel = () => {
      this.el.querySelector('INPUT[name=localize][value=off]').checked = true;
    };

    if (localize)
      popup({
        title: 'Localize Actions',
        message: `
          This means actions taken by your units are not sent to the server or
          seen by your opponent until your turn ends.  This grants you more
          freedom to undo and change your mind in lobby games and less lag if
          you have slow internet.  Note that luck-based attacks are always sent
          to the server and your opponent to determine the result.  Also,
          localized actions are disabled once your turn time limit shows less
          than 15 seconds remaining.  It is always disabled for Blitz games.
        `,
        buttons: [
          { label:'Enable', onClick:doSetLocalize },
          { label:'Cancel', onClick:cancel },
        ],
        maxWidth: '500px',
      });
    else
      doSetLocalize();
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
      localize: thisSettings.localize,
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
      // TODO: Delete this temporary migration
      if (settings.gameSpeed === '2')
        settings.gameSpeed = parseInt(settings.gameSpeed);
      this.data.game.speed = settings.gameSpeed;

      if (settings.localize === undefined)
        settings.localize = false;
      this.data.game.state.localize = settings.localize;

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
        localize: false,
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
