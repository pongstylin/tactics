import 'components/Modal/GameSettings.scss';
import Modal from 'components/Modal.js';
import fullscreen from 'components/fullscreen.js';

window.test = fullscreen;

export default class GameSettings extends Modal {
  constructor(options) {
    options.title = 'Game Settings';
    options.content = `
      <DIV class="row audio">
        <DIV class="label">Audio</DIV>
        <LABEL><INPUT type="radio" name="audio" value="on"> On</LABEL>
        <LABEL><INPUT type="radio" name="audio" value="off"> Off</LABEL>
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
    `;

    super(options);

    this.els = {
      modal: this.el.querySelector('.modal'),
      audio: this.el.querySelector('.audio'),
      fullscreen: this.el.querySelector('.fullscreen'),
      barPosition: this.el.querySelector('.barPosition'),
    };
    this.els.modal.classList.add('gameSettings');

    this.el.addEventListener('change', event => {
      switch (event.target.name) {
        case 'audio':
          this.toggleAudio();
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

    this.detectSettings();

    this._resizeListener = event => this.detectSettings();
    window.addEventListener('resize', this._resizeListener);
  }

  detectSettings() {
    let app = document.querySelector('#app');
    let settings = this.settings = {
      audio: !Howler._muted,
      fullscreen: fullscreen.isEnabled(),
      barPosition: app.classList.contains('left') ? 'left' : 'right',
    };

    if (settings.audio)
      this.el.querySelector('INPUT[name=audio][value=on]').checked = true;
    else
      this.el.querySelector('INPUT[name=audio][value=off]').checked = true;

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
    this.settings.audio = !this.settings.audio;

    Howler.mute(!this.settings.audio);
  }

  toggleFullscreen() {
    this.settings.fullscreen = !this.settings.fullscreen;

    fullscreen.toggle();
  }

  toggleBarPosition() {
    this.settings.barPosition = this.settings.barPosition === 'left' ? 'right' : 'left';

    let app = document.querySelector('#app');
    app.classList.toggle('left');
    app.classList.toggle('right');
  }

  destroy() {
    window.removeEventListener('resize', this._resizeListener);
  }
}
