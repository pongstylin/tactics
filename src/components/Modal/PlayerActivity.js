import 'components/Modal/PlayerActivity.scss';
import Modal from 'components/Modal.js';

const gameClient = Tactics.gameClient;

export default class PlayerActivity extends Modal {
  constructor(data, options = {}) {
    const { game, team } = data;

    options.title = `<SPAN class="playerName">${team.name}</SPAN> Activity`;
    options.content = `Loading player activity...`;

    super(options, data);

    this.root.classList.add('playerActivity');

    this.root.addEventListener('click', event => {
      const target = event.target;
      if (target.tagName !== 'BUTTON') return;

      if (target.name === 'close')
        this.close();
    });

    this.getPlayerActivity();

    this.data.trigger = ({ data }) => {
      if (game.endedAt)
        return;

      if (!Array.isArray(data))
        data = [data];

      if (data.find(ps => ps.playerId === team.playerId))
        this.getPlayerActivity();
    };
    game.state.on('playerStatus', this.data.trigger);
    game.state.on('endGame', event => {
      clearTimeout(this.data.timeout);
      this.close();
    });
  }

  getPlayerActivity() {
    const data = this.data;
    if (data.request) return;

    clearTimeout(data.timeout);

    data.request = gameClient.getPlayerActivity(data.game.id, data.team.playerId)
      .then(activity => {
        // Just in case the modal was closed before the request completed.
        if (!this.root) return;

        this.renderActivity(activity);
        data.timeout = setTimeout(() => this.getPlayerActivity(), 5000);
        data.request = null;
      })
      .catch(error => {
        if (error.message === 'May not get player activity for an ended game.')
          return;
        this.renderContent('Failed to load player activity.');
        throw error;
      });
  }

  getElapsed(idle) {
    let elapsed;
    if (idle > 86400)
      elapsed = `${Math.floor(idle / 86400)} day(s)`;
    else if (idle > 3600)
      elapsed = `${Math.floor(idle / 3600)} hour(s)`;
    else if (idle > 60)
      elapsed = `${Math.floor(idle / 60)} minute(s)`;
    else
      elapsed = `seconds`;

    return elapsed;
  }

  renderActivity({ generalStatus, gameStatus, idle, gameIdle, activity }) {
    const teamName = `<SPAN class="playerName">${this.data.team.name}</SPAN>`;
    const content = [
      `<DIV>`,
        `General Status: `,
        `<SPAN class="status ${generalStatus}">${generalStatus.toUpperCase('first')}</SPAN> `,
        `as of ${this.getElapsed(idle)} ago.`,
      `</DIV>`,
      `<DIV>`,
        `Game Status: `,
        `<SPAN class="status ${gameStatus}">${gameStatus.toUpperCase('first')}</SPAN> `,
        `as of ${this.getElapsed(gameIdle)} ago.`,
      `</DIV>`,
    ];

    if (activity) {
      content.push(`<DIV>Opened Active Games: ${activity.activeGamesCount}</DIV>`);
      content.push(`<DIV>Opened Inactive Games: ${activity.inactiveGamesCount}</DIV>`);

      // Fork games are always practice games that are currently open, but may be inactive.
      const forkGameLink = activity.forkGameId && `<A href="/game.html?${activity.forkGameId}" target="_blank">Watch</A>`;
      if (activity.forkGameId)
        content.push(`<DIV>${teamName} is running simulations in a fork of this game.  ${forkGameLink}`);

      // The most recently visited active game against you that isn't this one.
      const yourGameLink = activity.yourGameId && `<A href="/game.html?${activity.yourGameId}" target="_blank">Play</A>`;
      if (activity.yourGameId)
        content.push(`<DIV>${teamName} is playing you in another game.  ${yourGameLink}`);

      // An active game is only present if it is the only active game and all players are active in that game.
      const activeGameLink = activity.activeGameId && `<A href="/game.html?${activity.activeGameId}" target="_blank">Watch</A>`;
      if (activity.activeGameId)
        content.push(`<DIV>${teamName} is busy playing another game.  ${activeGameLink}`);
    }

    content.push(
      `<DIV class="controls">`,
        `<BUTTON name="close">Close</BUTTON>`,
      `</DIV>`,
    );

    this.renderContent(content.join(''));
  }

  destroy() {
    super.destroy();
    clearTimeout(this.data.timeout);
    this.data.game.state.off('playerStatus', this.data.trigger);
  }
}
