import 'components/Modal/Fork.scss';
import Modal from 'components/Modal.js';
import popup from 'components/popup.js';

export default class Fork extends Modal {
  constructor(data = {}, options = {}) {
    let game = data.game;
    let turnNumber = game.turnId + 1;
    let teamOptions = [];
    let inApp = window.matchMedia('(display-mode:standalone)').matches;

    data.vs = 'you';
    data.as = 0;
    for (let team of game.teams) {
      if (game.isMyTeam(team)) {
        data.as = team.id;
        break;
      }
    }

    for (let team of game.teams) {
      let teamMoniker;
      if (team.name && game.teams.filter(t => t.name === team.name).length === 1)
        teamMoniker = team.name;
      else
        teamMoniker = team.colorId;

      teamOptions.push(`
        <LI>
          <LABEL>
            <INPUT
              type="radio"
              name="as"
              value="${team.id}"
              disabled
              ${data.as === team.id ? 'checked' : ''}
            >
            ${teamMoniker}
          </LABEL>
        </LI>
      `);
    }

    let forkOf = game.state.forkOf;
    let fork = '';
    if (forkOf) {
      let of = game.ofSinglePlayer ? 'single player game' : 'game';

      fork = `
        <DIV>
          This game is a fork of <A href="/game.html?${forkOf.gameId}#c=${forkOf.turnId},0" target="_blank">that ${of}</A>.
        </DIV>
      `;
    }

    options.title = 'Fork the game?';
    options.content = `
      ${fork}
      <DIV>
        You are about to create a game playable from the beginning of turn ${turnNumber}.
        ${ inApp ? '' : 'It will be opened in a new tab or window.' }
      </DIV>
      <DIV>
        <DIV>Who would you like to play?</DIV>
        <UL class="indent">
          <LI><LABEL><INPUT type="radio" name="vs" value="you" checked> Yourself (Practice)</Label></LI>
          <LI><LABEL><INPUT type="radio" name="vs" value="private"> Invite Only (Private)</Label></LI>
        </UL>
      </DIV>
      <DIV>
        <DIV>Who would you like to play as?</DIV>
        <UL class="indent">
          ${teamOptions.join('')}
        </UL>
      </DIV>
      <DIV class="buttons">
        <BUTTON name="fork">Fork Game</BUTTON>
        <BUTTON name="done">Done</BUTTON>
      </DIV>
    `;

    super(options, data);

    Object.assign(this._els, {
      as: this.root.querySelectorAll('INPUT[name=as]'),
      fork: this.root.querySelector('BUTTON[name=fork]'),
      done: this.root.querySelector('BUTTON[name=done]'),
    });
    this.root.classList.add('fork');

    this.root.addEventListener('change', event => {
      switch (event.target.name) {
        case 'vs':
          this.data.vs = event.target.value;

          for (let asRadio of this._els.as) {
            asRadio.disabled = this.data.vs === 'you';
          }
          break;
        case 'as':
          this.data.as = parseInt(event.target.value);
          break;
      }
    }, true);

    this._els.fork.addEventListener('click', async event => {
      this._els.fork.disabled = true;

      try {
        const { game, vs, as } = this.data;
        const target = inApp ? window : window.open();
        const newGameId = await Tactics.gameClient.forkGame(game.id, {
          turnId: game.turnId,
          vs,
          as: vs === 'you' ? undefined : as,
        });

        target.location.href = `/game.html?${newGameId}`;
        this._els.fork.disabled = false;
      } catch (error) {
        fork.close();
        this._els.fork.disabled = false;

        if (error.code === 403)
          popup({ message:error.message });
        else {
          popup({ message:'Forking the game failed.' });
          throw error;
        }
      }
    });
    this._els.done.addEventListener('click', event => {
      this.close();
    });
  }
}
