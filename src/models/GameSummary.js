/*
 * This model is used to generate JSON with a summary of a game.
 * The summary can be used to render a game in a list.
 */
export default class GameSummary {
  constructor(props) {
    Object.assign(this, props);
  }

  static create(gameType, game) {
    const createdAt = game.createdAt;
    const startedAt = game.state.startedAt;
    const endedAt   = game.state.endedAt;
    const teams   = game.state.teams;
    const actions = game.state.actions;
    const turns   = game.state.turns;

    let updatedAt;
    if (endedAt)
      updatedAt = endedAt;
    else if (actions.length)
      updatedAt = actions.last.createdAt;
    else if (turns.length)
      updatedAt = turns.last.actions.last.createdAt;
    else
      updatedAt = startedAt || createdAt;

    const props = {
      id: game.id,
      type: gameType.id,
      typeName: gameType.name,
      createdBy: game.createdBy,
      createdAt,
      updatedAt,
      startedAt,
      endedAt,
      randomFirstTurn: game.state.randomFirstTurn,
      randomHitChance: game.state.randomHitChance,
      turnStartedAt: game.state.turnStartedAt,
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

    if (endedAt)
      props.winnerId = game.state.winnerId;
    else if (startedAt)
      props.currentTeamId = game.state.currentTeamId;

    return new GameSummary(props);
  }
  static load(props) {
    props.createdAt = new Date(props.createdAt);
    props.updatedAt = new Date(props.updatedAt);
    props.startedAt = props.startedAt && new Date(props.startedAt);
    props.endedAt = props.endedAt && new Date(props.endedAt);

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
