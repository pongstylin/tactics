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
    const game    = this.game;
    const created = game.created;
    const started = game.state.started;
    const ended   = game.state.ended;
    const teams   = game.state.teams;
    const actions = game.state.actions;
    const turns   = game.state.turns;

    let updatedAt;
    if (ended)
      updatedAt = ended;
    else if (actions.length)
      updatedAt = actions.last.created;
    else if (turns.length)
      updatedAt = turns.last.actions.last.created;
    else
      updatedAt = started || created;

    const summary = {
      id: game.id,
      type: this.type.id,
      typeName: this.type.name,
      createdBy: game.createdBy,
      createdAt: game.created,
      updatedAt,
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
        withUndo: t.withUndo,
      }),
    };

    if (ended)
      summary.winnerId = game.state.winnerId;
    else if (started)
      summary.currentTeamId = game.state.currentTeamId;

    return summary;
  }
}
