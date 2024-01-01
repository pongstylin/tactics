import '#plugins/index.js';
import config from '#config/server.js';
import AuthAdapter from '#data/FileAdapter/AuthAdapter.js';
import GameAdapter from '#data/FileAdapter/GameAdapter.js';

const authAdapter = await new AuthAdapter().bootstrap();
const gameAdapter = await new GameAdapter().bootstrap();
const playerIds = await authAdapter.listAllPlayerIds();
const gameIds = await gameAdapter.listAllGameIds();
const playerGamesMap = new Map();
const playersToDelete = new Set();
const gamesToDelete = new Set();
const gamesToArchive = new Set();

console.log('playerIds', playerIds.length);
console.log('gameIds', gameIds.length);

const getCollectionIds = collections => {
  const collectionIds = [];

  if (collections) {
    for (const collection of collections) {
      const prefix = collection.name;
      const subCollectionIds = getCollectionIds(collection.collections);
      if (subCollectionIds.length)
        collectionIds.push(...subCollectionIds.map(cId => `${prefix}/${cId}`));
      else
        collectionIds.push(prefix);
    }
  }

  return collectionIds;
};
const getPlayerGames = playerId => {
  if (!playerGamesMap.has(playerId))
    playerGamesMap.set(playerId, {
      practice: [],
      verses: [],
    });
  return playerGamesMap.get(playerId);
};

const indexed = {
  players: new Set(),
  games: new Set(),
  gamesBy: new Map(),
};

const collectionIds = getCollectionIds(config.services.get('game').config.collections);
for (const collectionId of collectionIds) {
  const collection = await gameAdapter._getGameCollection(collectionId);

  for (const gameSummary of collection.values()) {
    if (!gameSummary.startedAt)
      continue;
    indexed.games.add(gameSummary.id);
    for (const team of gameSummary.teams)
      indexed.players.add(team.playerId);
  }
}

const since = Date.now() - 30 * 86400 * 1000;
const inactivePlayerIds = new Set();

for (const playerId of playerIds) {
  try {
    const playerGames = await gameAdapter._getPlayerGames(playerId);
    for (const gameId of playerGames.keys())
      if (indexed.gamesBy.has(gameId))
        indexed.gamesBy.get(gameId).add(playerId);
      else
        indexed.gamesBy.set(gameId, new Set([ playerId ]));

    const player = await authAdapter._getPlayer(playerId);

    if (player.lastSeenAt > since)
      continue;
    if (player.hasAuthProviderLink('discord'))
      continue;
    if (player.hasAuthProviderLink('facebook'))
      continue;

    inactivePlayerIds.add(playerId);
  } catch (e) {
    if (e.message.startsWith('Corrupt:'))
      playersToDelete.add(playerId);
    else
      throw e;
  }
}

for (const gameId of gameIds) {
  try {
    const game = await gameAdapter._getGame(gameId);

    if (!game.state.startedAt) {
      if (game.createdAt < since)
        gamesToDelete.add(gameId);
      continue;
    }

    if (game.forkOf) {
      if (game.createdAt < since)
        gamesToDelete.add(gameId);
      continue;
    }

    const minTurnId = game.state.getFirstTurnId() + 3;
    if (game.state.currentTurnId < minTurnId) {
      if (game.createdAt < since)
        gamesToDelete.add(gameId);
      continue;
    }

    const gamePlayerIds = [ ...new Set(game.state.teams.map(t => t.playerId)) ];

    if (gamePlayerIds.length === 1)
      getPlayerGames(gamePlayerIds[0]).practice.push(gameId);
    else
      for (const team of game.state.teams)
        getPlayerGames(team.playerId).verses.push(gameId);
  } catch (e) {
    if (e.message.startsWith('Corrupt:'))
      gamesToDelete.add(gameId);
    else
      throw e;
  }
}

const hasIndexedGame = playerId => {
  for (const gameId of getPlayerGames(playerId).verses) {
    if (indexed.games.has(gameId))
      return true;
    if (indexed.gamesBy.has(gameId))
      for (const vsPlayerId of indexed.gamesBy.get(gameId))
        if (vsPlayerId !== playerId && !inactivePlayerIds.has(vsPlayerId))
          return true;
  }

  return false;
};

let initial = -1;
while (inactivePlayerIds.size !== initial) {
  initial = inactivePlayerIds.size;
  console.log('pass', initial);

  for (const playerId of [ ...inactivePlayerIds ])
    if (playersToDelete.has(playerId) || hasIndexedGame(playerId))
      inactivePlayerIds.delete(playerId);
}

for (const playerId of inactivePlayerIds) {
  playersToDelete.add(playerId);
  for (const gameId of getPlayerGames(playerId).practice)
    gamesToDelete.add(gameId);
  for (const gameId of getPlayerGames(playerId).verses)
    gamesToArchive.add(gameId);
}

console.log('playersToDelete', playersToDelete.size);
console.log('gamesToDelete', gamesToDelete.size);
console.log('gamesToArchive', gamesToArchive.size);

for (const playerId of playersToDelete) {
  await authAdapter.archivePlayer(playerId);
  await gameAdapter.archivePlayer(playerId);
}

for (const gameId of gamesToDelete) {
  await gameAdapter.archiveGame(gameId);
}

for (const gameId of gamesToArchive) {
  await gameAdapter.archiveGame(gameId);
}

await authAdapter.cleanup();
await gameAdapter.cleanup();
