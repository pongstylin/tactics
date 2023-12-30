import fs from 'fs';

import '#plugins/index.js';
import FileAdapter from '#data/FileAdapter.js';
import migrate, { getLatestVersionNumber } from '#data/migrate.js';
import serializer from '#utils/serializer.js';

import Identities from '#models/Identities.js';
import Identity from '#models/Identity.js';
import Player from '#models/Player.js';
import Provider from '#models/Provider.js';
import Room from '#models/Room.js';

const filesDir = 'src/data/files';
const dataAdapter = new FileAdapter({ name:'data', filesDir });
const providersById = new Map([
  [ 'discord',  Provider.create('discord') ],
  [ 'facebook', Provider.create('facebook') ],
]);
const authMemberFiles = new Map([
  [ 'discord',  'auth/discord_members'  ],
  [ 'facebook', 'auth/facebook_members' ],
]);
const playerFileMatch = new RegExp('^player_[0-9a-f\\-]{36}\\.json$');
const playerFiles = fs.readdirSync(`${filesDir}/auth`)
  .filter(fn => playerFileMatch.test(fn) && fs.statSync(`${filesDir}/auth/${fn}`).size > 0)
  .map(fn => `auth/${fn}`.replace('.json', ''));
const identities = Identities.create();
const identitiesById = new Map();
const playersById = new Map();
const relationshipsByPlayerId = new Map();
const links = [];

const test = new Map((await dataAdapter.getFile('auth/discord_members')).$data.links);

/*
 * Migrate Players and create identities.
 */
for (const playerFile of playerFiles) {
  const playerData = migrate('player', await dataAdapter.getFile(playerFile));

  const playerId = playerData.$data.id;

  if (playerData.$data.log) {
    for (const log of playerData.$data.log) {
      // Hack: Data fix
      if (log.data.provider === undefined) {
        if (log.data.memberId === '5515685761822871')
          log.data.provider = 'facebook';
        else
          log.data.provider = 'discord';
      }

      log.playerId = playerId;
      log.createdAt = new Date(log.createdAt);
      links.push(log);
    }
    delete playerData.$data.log;
  }

  if (playerData.$data.acl) {
    for (const [ relationId, relationship ] of playerData.$data.acl) {
      if (!relationshipsByPlayerId.has(playerId))
        relationshipsByPlayerId.set(playerId, new Map());
      relationshipsByPlayerId.get(playerId).set(relationId, {
        type: relationship.type,
        name: relationship.name,
        createdAt: new Date(relationship.createdAt),
      });
    }
    delete playerData.$data.acl;
  }

  playerData.$data.checkinAt = playerData.$data.checkoutAt;
  delete playerData.$data.reverseACL;

  const player = serializer.normalize(playerData);
  player.identities = identities;
  player.identity = Identity.create(player);
  playersById.set(player.id, player);
  identitiesById.set(player.identityId, player.identity);
}

/*
 * Apply relationships to Players.
 */
for (const [ playerId, relationships ] of relationshipsByPlayerId) {
  const player = playersById.get(playerId);
  for (const [ relationId, relationship ] of relationships) {
    const relation = playersById.get(relationId);
    player.setRelationship(relation, relationship);
  }
}

/*
 * Index identities
 */
for (const identity of identitiesById.values())
  identities.add(identity);

/*
 * Apply links to players and merge identities.
 */
identities.on('change:merge', ({ data:{ identity } }) => identitiesById.delete(identity.id));

for (const link of links.sort((a,b) => a.createdAt - b.createdAt)) {
  const player = playersById.get(link.playerId);
  const provider = providersById.get(link.data.provider);
  const memberId = link.data.memberId;

  if (link.type === 'link') {
    const oldLink = provider.getLinkByMemberId(memberId);
    const oldLinkPlayer = oldLink && playersById.get(oldLink.playerId);
    if (oldLink?.active) {
      if (oldLink.playerId === player.id)
        continue;
      else
        oldLinkPlayer.unlinkAuthProvider(provider);
    }

    const newLinkPlayer = player;
    newLinkPlayer.linkAuthProvider(provider, memberId);

    // Identities are unaffected if linking a player to a new member
    if (oldLinkPlayer === null)
      continue;

    // Identities are unaffected if moving a link to a different player under the same identity.
    if (oldLinkPlayer.identityId === newLinkPlayer.identityId)
      continue;

    const newLinkPlayers = newLinkPlayer.identity.playerIds.map(pId => playersById.get(pId));

    identities.merge(oldLinkPlayer.identity, newLinkPlayer.identity, newLinkPlayers);
  } else if (link.type === 'unlink') {
    player.unlinkAuthProvider(provider);
  } else {
    throw new Error('what?');
  }
}

/*
 * Preserve manual intervention for Joe Problemo
 */
const player1 = playersById.get('a57e75b8-1e0c-4e76-ad05-324eedb5d282');
const player2 = playersById.get('ceb38780-913d-4215-b937-7bb7f0ca0070');
player1.unlinkAuthProvider(providersById.get('discord'), '601598346431430656');
player2.linkAuthProvider(providersById.get('discord'), '601598346431430656');

/*
 * Chat room migration
 */
const gameFileMatch = new RegExp('^game_[0-9a-f\\-]{36}\\.json$');
const gameFiles = fs.readdirSync(`${filesDir}/game`)
  .filter(fn => gameFileMatch.test(fn) && fs.statSync(`${filesDir}/game/${fn}`).size > 0)
  .map(fn => `game/${fn}`.replace('.json', ''));
let numGames = 0;
const roomsById = new Map();

for (const gameFile of gameFiles) {
  const gameData = migrate('game', await dataAdapter.getFile(gameFile));
  numGames++;

  if (gameData.$data.collection)
    continue;
  if (!gameData.$data.state.startedAt)
    continue;

  const playerIds = new Set(gameData.$data.state.teams.map(t => t.playerId));
  if (playerIds.size === 1)
    continue;

  try {
    const roomFile = `chat/room_${gameData.$data.id}`;
    const roomData = migrate('room', await dataAdapter.getFile(roomFile));
    roomData.$data.applyRules = false;

    const room = serializer.normalize(roomData);
    roomsById.set(room.id, room);
  } catch (e) {
    console.log('fail', e, gameData);
    throw e;
  }
}

/*
 * Save all the work
 */
let queue;

console.log(`Saving identities object (${ identities.getIds().length })...`);
await dataAdapter.putFile(`auth`, () => serializer.transform({ identities }));

console.log(`Saving ${providersById.size} provider objects...`);
await Promise.all([ ...providersById.values() ].map(p => dataAdapter.putFile(`auth/provider_${p.id}`, () => {
  const data = serializer.transform(p);
  data.version = getLatestVersionNumber('provider');
  return data;
})));

console.log(`Saving ${playersById.size} player objects...`);
queue = [ ...playersById.values() ];
for (let i = 0; i < Math.ceil(queue.length / 1024); i++) {
  await Promise.all(queue.slice(i*1024, (i+1)*1024).map(p => dataAdapter.putFile(`auth/player_${p.id}`, () => {
    const data = serializer.transform(p);
    data.version = getLatestVersionNumber('player');
    return data;
  })));
}

console.log(`Saving ${identitiesById.size} identity objects...`);
queue = [ ...identitiesById.values() ];
for (let i = 0; i < Math.ceil(queue.length / 1024); i++) {
  await Promise.all(queue.slice(i*1024, (i+1)*1024).map(i => dataAdapter.putFile(`auth/identity_${i.id}`, () => {
    const data = serializer.transform(i);
    data.version = getLatestVersionNumber('identity');
    return data;
  })));
}

console.log(`Saving ${roomsById.size} room objects...`);
queue = [ ...roomsById.values() ];
for (let i = 0; i < Math.ceil(queue.length / 1024); i++) {
  await Promise.all(queue.slice(i*1024, (i+1)*1024).map(r => dataAdapter.putFile(`chat/room_${r.id}`, () => {
    const data = serializer.transform(r);
    data.version = getLatestVersionNumber('room');
    return data;
  })));
}
