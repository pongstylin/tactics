/*
 * This model is used to generate JSON with a summary of a game.
 * The summary can be used to render a game in a list.
 */
export default class GameSummary {
  constructor(gameType, game) {
    this.type = gameType;
    this.game = game;
  }

  toJSON() {
    let game    = this.game;
    let created = game.created;
    let started = game.state.started;
    let ended   = game.state.ended;
    let teams   = game.state.teams;
    let actions = game.state.actions;
    let turns   = game.state._turns;

    let updated;
    if (ended)
      updated = ended;
    else if (actions.length)
      updated = actions.last.created;
    else if (turns.length)
      updated = turns.last.actions.last.created;
    else
      updated = started || created;

    let summary = {
      id: game.id,
      type: this.type.id,
      typeName: this.type.name,
      created: created,
      updated: updated,
      started: started,
      ended: ended,
      randomFirstTurn: game.state.randomFirstTurn,
      randomHitChance: game.state.randomHitChance,
      turnStarted: game.state.turnStarted,
      turnTimeLimit: game.state.turnTimeLimit,
      isPublic: game.isPublic,
      isFork: !!game.forkOf,
      teams: teams.map(t => t && {
        createdAt: t.createdAt,
        joinedAt: t.joinedAt,
        playerId: t.playerId,
        name: t.name,
      }),
    };

    if (ended)
      summary.winnerId = game.state.winnerId;
    else if (started)
      summary.currentTeamId = game.state.currentTeamId;

    return summary;
  }
}
