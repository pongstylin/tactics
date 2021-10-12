/*
 * This model is used to generate JSON with a summary of a game.
 * The summary can be used to render a game in a list.
 */
export default class GameSummary {
  constructor(props) {
    Object.assign(this, props);
  }

  static create(gameType, game) {
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

    const props = {
      id: game.id,
      type: gameType.id,
      typeName: gameType.name,
      createdBy: game.createdBy,
      createdAt: created,
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
      props.winnerId = game.state.winnerId;
    else if (started)
      props.currentTeamId = game.state.currentTeamId;

    return new GameSummary(props);
  }
  static load(props) {
    props.createdAt = new Date(props.createdAt);
    props.updatedAt = new Date(props.updatedAt);
    props.started = props.started && new Date(props.started);
    props.ended = props.ended && new Date(props.ended);

    for (const team of props.teams) {
      if (!team) continue;

      team.createdAt = new Date(team.createdAt);
      team.joinedAt = team.joinedAt && new Date(team.joinedAt);
    }

    return new GameSummary(props);
  }

  toJSON() {
    return { ...this };
  }
}
