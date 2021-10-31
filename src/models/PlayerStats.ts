import ActiveModel from 'models/ActiveModel.js';

export default class PlayerStats extends ActiveModel {
  data: Map<any, any>
  playerId: string
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
    if (!game.state.startedAt)
      throw new Error('Game has not started yet');
    if (game.state.endedAt)
      throw new Error('Game already ended');

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
    if (!game.state.startedAt)
      throw new Error('Game has not started yet');
    if (!game.state.endedAt)
      throw new Error('Game has not ended');
    // No WLD stats for fork games.
    if (game.forkOf)
      return;

    const myTeams = game.state.teams.filter(t => t.playerId === this.playerId);
    if (myTeams.length === 0)
      throw new Error(`Game was not played by ${this.playerId}`);

    // No stats for practice games.
    const numTeams = game.state.teams.length;
    if (myTeams.length === numTeams)
      return;

    /*
     * Determine which players played a turn.
     */
    // The number of turns excludes the game end turn.
    const currentTurnId = game.state.currentTurnId;
    const playedBy = new Set();
    for (const team of game.state.teams) {
      if (
        game.state.winnerId === 'truce' ||
        game.state.winnerId === 'draw' ||
        game.state.winnerId === team.id
      ) {
        playedBy.add(team.playerId);
        continue;
      }

      const waitTurns = Math.min(...team.set.units.map(u => u.mRecovery ?? 0));
      const skipTurns = numTeams === 2 && team.id === 0 ? 1 : 0;
      const firstTurnId = team.id + (numTeams * Math.max(waitTurns, skipTurns));
      if (currentTurnId < firstTurnId)
        continue;

      /*
       * If the game ended on the turn after this team's first turn, then it
       * is possible that this team surrendered.  If so, turn not played.
       */
      const actions = currentTurnId === firstTurnId
        ? game.state.actions
        : game.state.turns[firstTurnId].actions;
      const playedAction = actions.find(a => a.type !== 'surrender' && !a.forced);
      if (!playedAction)
        continue;

      playedBy.add(team.playerId);
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

        const myAdvantage = myTeams[0].usedUndo || myTeams[0].usedSim;
        const vsAdvantage = team.usedUndo || team.usedSim;

        if (game.state.winnerId === myTeams[0].id) {
          // If I won with advantage, but they didn't use advantage, win is with advantage.
          const wldIndex = myAdvantage && !vsAdvantage ? 1 : 0;
          stats.all.win[wldIndex]++;
          stats.style.get(game.state.type).win[wldIndex]++;
        } else if (game.state.winnerId === teamId) {
          // If I lost without advantage, but they used advantage, the loss is at disadvantage.
          const wldIndex = vsAdvantage && !myAdvantage ? 1 : 0;
          stats.all.lose[wldIndex]++;
          stats.style.get(game.state.type).lose[wldIndex]++;
        } else if (game.state.winnerId === 'draw') {
          // If I drew with advantage, but they didn't use advantage, draw is with advantage.
          // Note: If we both lost in a 4-player game, we drew with each other.
          const wldIndex = myAdvantage && !vsAdvantage ? 1 : 0;
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
    // @ts-ignore
    return this.data.toJSON();
  }
}
