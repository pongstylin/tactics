import ActiveModel from 'models/ActiveModel.js';

export default class PlayerStats extends ActiveModel {
  constructor(playerId, data) {
    super({
      playerId,
      data,
    });
  }

  static load(playerId, data) {
    data = new Map(data);

    for (const [ pId, stats ] of data) {
      if (pId === playerId) continue;

      stats.aliases = new Map(stats.aliases);
      for (const alias of stats.aliases.values()) {
        alias.lastSeenAt = new Date(alias.lastSeenAt);
      }

      stats.all.startedAt = new Date(stats.all.startedAt);
      stats.style = new Map(stats.style);
      for (const style of stats.style.values()) {
        style.startedAt = new Date(style.startedAt);
      }
    }

    return new PlayerStats(playerId, data);
  }

  get(playerId) {
    return this.data.get(playerId);
  }

  recordGameStart(game) {
    if (!game.state.started)
      throw new Error('Game has not started yet');
    if (game.state.ended)
      throw new Error('Game already ended');
    // No stats for fork games.
    if (game.forkOf)
      return;

    const myTeams = game.state.teams.filter(t => t.playerId === this.playerId);
    if (myTeams.length === 0)
      throw new Error(`Game was not played by ${this.playerId}`);

    // No stats for practice games.
    if (myTeams.length === game.state.teams.length)
      return;

    const now = Date.now();

    for (const team of game.state.teams) {
      if (!this.data.has(team.playerId)) {
        if (team.playerId === this.playerId)
          // Global stats
          this.data.set(team.playerId, {
            // Played X games and abandoned Y games.
            completed: [0, 0],
          });
        else
          // Individual stats
          this.data.set(team.playerId, {
            name: team.name,
            aliases: new Map(),
            all: {
              startedAt: now,
              win: [0, 0],
              lose: [0, 0],
              draw: [0, 0],
            },
            style: new Map(),
          });
      }

      if (team.playerId !== this.playerId) {
        const stats = this.data.get(team.playerId);

        if (stats.aliases.has(team.name.toLowerCase())) {
          const alias = stats.aliases.get(team.name.toLowerCase());
          alias.name = team.name;
          alias.count++;
          alias.lastSeenAt = now;
        } else {
          stats.aliases.set(team.name.toLowerCase(), {
            name: team.name,
            count: 1,
            lastSeenAt: now,
          });
        }

        if (!stats.style.has(game.state.type)) {
          stats.style.set(game.state.type, {
            startedAt: now,
            win: [0, 0],
            lose: [0, 0],
            draw: [0, 0],
          });
        }
      }
    }

    this.emit('change:recordGameStart');
  }
  recordGameEnd(game) {
    if (!game.state.started)
      throw new Error('Game has not started yet');
    if (!game.state.ended)
      throw new Error('Game has not ended');
    // No stats for fork games.
    if (game.forkOf)
      return;

    const myTeams = game.state.teams.filter(t => t.playerId === this.playerId);
    if (myTeams.length === 0)
      throw new Error(`Game was not played by ${this.playerId}`);

    // No stats for practice games.
    if (myTeams.length === game.state.teams.length)
      return;

    /*
     * Determine which players played a turn.
     */
    const playedBy = new Set();
    for (const team of game.state.teams) {
      if (team.id === game.state.winnerId) {
        playedBy.add(team.playerId);
        continue;
      }

      for (let turnId = team.id; turnId < game.state.turns.length; turnId += game.state.teams.length) {
        const actions = game.state.turns[turnId].actions;
        // Auto passed turns don't count
        if (actions.length === 1 && actions.last.forced)
          continue;
        // If this team surrendered (forced or not), this turn wasn't played.
        if (actions.find(a => a.type === 'surrender')?.teamId === team.id)
          continue;

        playedBy.add(team.playerId);
        break;
      }
    }

    for (const [ teamId, team ] of game.state.teams.entries()) {
      if (!this.data.has(team.playerId))
        throw new Error('Game start not recorded');

      const stats = this.data.get(team.playerId);
      /*
       * Collect completed/abandoned game counts for the current player.
       */
      if (team.playerId === this.playerId) {
        if (playedBy.has(this.playerId)) {
          // I didn't really complete a game if every other player abandoned it.
          if (playedBy.size === 1)
            continue;

          stats.completed[0]++;
        } else {
          stats.completed[1]++;
        }
      /*
       * Collect WLD stats against the opponent.
       */
      } else {
        // If either I or this player abandoned the game, do not collect WLD stats.
        if (!playedBy.has(this.playerId) || !playedBy.has(team.playerId))
          continue;

        if (game.state.winnerId === myTeams[0].id) {
          // If I won with undo, but they didn't use undo, win is with advantage.
          const wldIndex = myTeams[0].usedUndo && !team.usedUndo ? 1 : 0;
          stats.all.win[wldIndex]++;
          stats.style.get(game.state.type).win[wldIndex]++;
        } else if (game.state.winnerId === teamId) {
          // If I lost without undo, but they used undo, the loss is at disadvantage.
          const wldIndex = team.usedUndo && !myTeams[0].usedUndo ? 1 : 0;
          stats.all.lose[wldIndex]++;
          stats.style.get(game.state.type).lose[wldIndex]++;
        } else {
          // If I drew with undo, but they didn't use undo, draw is with advantage.
          // Note: If we both lost in a 4-player game, we drew with each other.
          const wldIndex = myTeams[0].usedUndo && !team.usedUndo ? 1 : 0;
          stats.all.draw[wldIndex]++;
          stats.style.get(game.state.type).draw[wldIndex]++;
        }
      }
    }

    this.emit('change:recordGameEnd');
  }

  clearWLDStats(playerId, gameTypeId = null) {
    const stats = this.data.get(playerId);

    let wldStats;
    if (gameTypeId) {
      if (!stats.style.has(gameTypeId))
        return;

      wldStats = stats.style.get(gameTypeId);
    } else
      wldStats = stats.all;

    const count = (
      wldStats.win[0]  + wldStats.win[1] +
      wldStats.lose[0] + wldStats.lose[1] +
      wldStats.draw[0] + wldStats.draw[1]
    );
    if (count === 0)
      return;

    Object.assign(wldStats, {
      startedAt: Date.now(),
      win: [0, 0],
      lose: [0, 0],
      draw: [0, 0],
    });

    this.emit('change:clearWLDStats');
  }

  toJSON() {
    return this.data.toJSON();
  }
}
