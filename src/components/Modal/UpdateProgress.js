import 'components/Modal/UpdateProgress.scss';
import Modal from 'components/Modal.js';
import { getWorkerVersion, skipWaiting } from 'client/Update.js';

export default class UpdateProgress extends Modal {
  constructor(data, options = {}) {
    options.title = `App Update`;
    options.content = `
      <DIV class="preamble">
        Please wait while a new update is installed.
        It must be activated to continue.
        If it gets stuck, try reloading the app.
      </DIV>
      <DIV class="progress">
        <DIV class="indicator"></DIV>
        <DIV class="label"></DIV>
      </DIV>
      <DIV class="buttons">
        <BUTTON name="reload">Reload</BUTTON>
      </DIV>
    `;

    super(options, data);

    this.data.steps = [
      // No update seen yet
      'Locating...',
      // Update is in reg.installing, state=installing
      'Downloading...',
      // Update is in reg.waiting, state=installed
      'Installing...',
      // Update is in reg.active, state=activating
      'Installing...',
      // Update is in reg.active, state=activated
      'Installed.',
    ];

    Object.assign(this._els, {
      preamble: this.root.querySelector('.preamble'),
      label: this.root.querySelector('.label'),
      indicator: this.root.querySelector('.indicator'),
      reload: this.root.querySelector('BUTTON[name=reload]'),
    });
    this.root.classList.add('updateProgress');
    this._els.reload.addEventListener('click', () => this.reload());

    this.init();
  }

  init() {
    this.data.history = [];
    this.data.listener = () => this.checkStatus();
    this.data.reg.addEventListener('updatefound', this.data.listener);

    for (let i = 0; i < this.data.steps.length; i++) {
      const step = document.createElement('SPAN');
      step.classList.add('step');

      this._els.indicator.appendChild(step);
    }

    this.checkStatus();
  }

  async checkStatus() {
    /*
     * The main utility of this timeout is in the 1st step where we are looking
     * for a new service worker script.  Normally, step progression is event-
     * driven.  But the timeout is maintained to monitor for slow progress.
     */
    if (this.data.timeout)
      clearTimeout(this.data.timeout);
    this.data.timeout = setTimeout(this.data.listener, 5000);

    if (!this.data.worker) {
      const reg = this.data.reg;
      const worker = reg.installing || reg.waiting || reg.active;

      if (worker === null)
        // Wait for 'updatefound' for this new registration.
        return this.setStep(0);
      else if (this.data.version.isCompatibleWith(await getWorkerVersion(worker))) {
        reg.removeEventListener('updatefound', this.data.listener);
        worker.addEventListener('statechange', this.data.listener);
        this.data.worker = worker;
      } else {
        // Update existing worker and wait for 'updatefound'.
        reg.update().catch(error => {
          report({ type:'update', error:getErrorData(error) });
          this.checkStatus();
        });
        return this.setStep(0);
      }
    }

    const worker = this.data.worker;
    if (worker.state === 'installing')
      return this.setStep(1);
    else if (worker.state === 'installed')
      return this.setStep(2);
    else if (worker.state === 'activating')
      return this.setStep(3);
    else if (worker.state === 'activated')
      return this.setComplete();
    else if (worker.state === 'redundant')
      return this.setFailed();
  }
  setStep(stepId) {
    const indicator = this._els.indicator;
    if (indicator.children[stepId].classList.contains('lit')) {
      if (stepId === 2) {
        this.data.history.push({
          createdAt: new Date(),
          type: 'skipWaiting',
        });
        skipWaiting(this.data.worker);
      } else {
        this.data.history.push({
          createdAt: new Date(),
          type: 'delayed',
          stepId,
        });
      }
      return;
    } else
      this.data.history.push({
        createdAt: new Date(),
        type: 'step',
        stepId,
      });

    const stepLabel = this.data.steps[stepId];
    this._els.label.textContent = stepLabel;

    for (let i = 0; i <= stepId; i++) {
      indicator.children[i].classList.add('lit');
    }
  }
  setComplete() {
    this._els.preamble.textContent = 'A new update is ready for activation.';
    this._els.reload.textContent = 'Activate';
    this.setStep(4);

    this.cleanup();
  }
  setFailed() {
    this._els.preamble.textContent = [
      'A new update failed to install.',
      'You can try reloading or coming back later.',
    ].join('  ');
    this._els.label.textContent = 'Failed.';
    this._els.indicator.classList.add('error');

    this.data.history.push({
      createdAt: new Date(),
      type: 'fail',
    });
    this.cleanup();
  }

  reload() {
    this._els.preamble.textContent = 'Reloading, please wait...';

    this.cleanup();
    setTimeout(() => location.reload());
  }

  cleanup() {
    const history = this.data.history;
    if (history === null)
      return;
    this.data.history = null;

    if (this.data.timeout) {
      clearTimeout(this.data.timeout);
      this.data.timeout = null;
    }
    if (this.data.worker)
      this.data.worker.removeEventListener('statechange', this.data.listener);
    else
      this.data.reg.removeEventListener('updatefound', this.data.listener);

    if (history.find(h => h.type !== 'step'))
      report({ type:'update', history });
  }
}
