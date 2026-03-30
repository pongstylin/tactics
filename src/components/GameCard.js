import * as arena from 'components/GameArena.js';

setInterval(() => {
  for (const spnClock of document.querySelectorAll('.clock'))
    spnClock.update();
}, 30000);

export const teamInfo = new WeakMap();

/*
 * Compute a stable group id for a waiting game based on the fields that are
 * shared across grouped games.  Style (type) is intentionally excluded since
 * that is what varies within a group.  The colon-separated string is safe to
 * use as a DOM id since all lookups use getElementById rather than querySelector.
 */
export function getWaitingGroupId(gameSummary) {
  return [
    gameSummary.createdBy,
    gameSummary.timeLimitName,
    gameSummary.randomHitChance,
    gameSummary.rated,
    gameSummary.mode ?? '',
  ].join(':');
}

export function renderGame(game, { playerId = null, setId = null, rankingId = null } = {}) {
  const team1 = game.teams.find(t => setId ? t?.set?.id === setId : t?.playerId === (playerId ?? game.createdBy));
  const ranks1 = game.meta.ranks[team1.id];
  const team2 = game.teams.find(t => t !== team1);
  const ranks2 = team2 && game.meta.ranks[team2.id];

  rankingId ??= game.type;

  const divGame = document.createElement('DIV');
  divGame.id = game.id;
  divGame.dataset.type = game.type;
  divGame.classList.add('game');

  const divVS = document.createElement('DIV');
  divVS.classList.add('vs');

  const divArenaWrapper = document.createElement('DIV');
  divArenaWrapper.classList.add('arena-wrapper');

  const divArena = arena.renderArena(0);
  divArenaWrapper.append(divArena);
  arena.fillArena(divArena, game);

  divVS.append(divArenaWrapper);
  if (game.isChallenge && !team1.joinedAt)
    divVS.append(renderGameDecline(game));
  else
    divVS.append(renderGameTeam(game, team1, ranks1, rankingId));
  divVS.append(renderGameResult(game, team1.playerId));
  if (game.isSimulation && !game.startedAt)
    divVS.append(renderGameFinishSetup(game));
  else if (team2?.playerId)
    divVS.append(renderGameTeam(game, team2, ranks2, rankingId));
  else if (game.createdBy === Tactics.authClient.playerId)
    divVS.append(renderGameInvite(game));
  divGame.append(divVS);

  divGame.append(renderGameInfo(game));

  return divGame;
}

/*
 * Render a grouped card for multiple waiting games from the same creator that
 * share the same details except style.  The group id is used as the DOM id.
 *
 * When the group contains only one game, delegates to renderGame with the
 * group id substituted as the DOM id — normal single-game appearance and join
 * semantics apply (no style selector).
 *
 * When the group contains 2+ games, renders a combined card using the oldest
 * game for shared metadata (avatar, name, ranks) and shows "<n> Styles" in
 * the info bar instead of a style name.
 */
export function renderGameGroup(groupId, games) {
  const gameList = Array.from(games.values());

  if (gameList.length === 1)
    return renderGame(gameList[0]);

  // Use the oldest game for shared metadata.
  const oldest = gameList.reduce((a, b) => a.createdAt < b.createdAt ? a : b);

  const divGame = document.createElement('DIV');
  divGame.id = groupId;
  divGame.dataset.type = 'group';
  divGame.classList.add('game');

  const divVS = document.createElement('DIV');
  divVS.classList.add('vs');

  const divArenaWrapper = document.createElement('DIV');
  divArenaWrapper.classList.add('arena-wrapper');

  const divArena = arena.renderArena(0);
  divArenaWrapper.append(divArena);
  arena.fillArena(divArena, oldest);

  const team1 = oldest.teams.find(t => t?.playerId === oldest.createdBy);
  const ranks1 = oldest.meta.ranks[team1.id];

  divVS.append(divArenaWrapper);

  const divTeam1 = document.createElement('DIV');
  divTeam1.classList.add('team');
  divTeam1.classList.toggle('linkable', !!ranks1);
  teamInfo.set(divTeam1, { game: oldest, team: { ...team1, set: null }, ranks: ranks1 });
  divTeam1.innerHTML = `<DIV class="name">${team1.name}</DIV>`;
  divVS.append(divTeam1);
  divVS.append(renderGameResult(oldest, team1.playerId));
  divGame.append(divVS);
  divGame.append(renderGameGroupInfo(oldest, gameList.length));

  return divGame;
}

function renderGameTeam(game, team, ranks, rankingId) {
  const divTeam = document.createElement('DIV');
  divTeam.classList.add('team');
  divTeam.classList.toggle('linkable', !!ranks || !!team.set);

  teamInfo.set(divTeam, { game, team, ranks });

  const rank = ranks && (ranks.find(r => r.rankingId === rankingId) ?? null);
  const defaultRating = rankingId === 'FORTE' ? 0 : 750;
  const rating = [];

  if (game.rated) {
    const vsRatings = team.ratings.get(rankingId) ?? [ defaultRating, defaultRating ];
    const change = vsRatings[1] - vsRatings[0];
    const label = Math.abs(vsRatings[1] - vsRatings[0]) || '';

    rating.push(`<SPAN class="initial">${vsRatings[0]}</SPAN>`);
    rating.push(`<SPAN class="${label ? change > 0 ? 'up' : 'down' : ''}">${label}</SPAN> `);
  }

  if (ranks === null)
    rating.push(`<SPAN class="current">(Inactive)</SPAN>`);
  else if (ranks === false)
    rating.push(`<SPAN class="current">(Guest)</SPAN>`);
  else if (rank)
    rating.push(`<SPAN class="current">(${rank.rating})</SPAN>`);
  else
    rating.push(`<SPAN class="current">(${defaultRating})</SPAN>`);

  divTeam.innerHTML = `
    <DIV class="name">${team.name}</DIV>
    <DIV class="rating">${rating.join('')}</DIV>
    <DIV class="set">${team.set ? game.meta.setNames[team.id] ?? team.set.name : ''}</DIV>
  `;

  return divTeam;
}
function renderGameDecline() {
  const divDecline = document.createElement('DIV');
  divDecline.classList.add('decline');
  divDecline.innerHTML = `<A href="javascript:void(0)">Decline Game</A>`;

  return divDecline;
}
function renderGameFinishSetup(game) {
  const divFinishSetup = document.createElement('DIV');
  divFinishSetup.innerHTML = `<A href="game.html?${game.id}">Finish Setup</A>`;

  return divFinishSetup;
}
function renderGameInvite(game) {
  const divInvite = document.createElement('DIV');
  divInvite.classList.add('invite');
  if (navigator.share) {
    divInvite.classList.add('share');
    divInvite.innerHTML = `<SPAN class="fa fa-share"></SPAN><SPAN class="label">Share Invite Link</SPAN>`;
  } else {
    divInvite.classList.add('copy');
    divInvite.innerHTML = `<SPAN class="fa fa-copy"></SPAN><SPAN class="label">Copy Invite Link</SPAN>`;
  }

  return divInvite;
}
function renderGameResult(game, playerId) {
  const divResult = document.createElement('DIV');
  divResult.classList.add('result');

  const spnResult = document.createElement('SPAN');
  divResult.append(spnResult);

  if (game.endedAt)
    spnResult.textContent = (
      game.winnerId === 'draw' ? 'Draw!' :
      game.winnerId === 'truce' ? 'Truce!' :
      game.winner?.playerId === playerId ? 'Win!' : 'Lose!'
    );
  else
    spnResult.textContent = 'VS';

  return divResult;
}
function renderGameInfo(game) {
  const divInfo = document.createElement('DIV');
  divInfo.classList.add('info');

  const labels = [];
  labels.push(game.typeName);
  if (!game.randomHitChance)
    labels.push('No Luck');
  if (game.timeLimitName && game.timeLimitName !== 'standard')
    labels.push(game.timeLimitName.toUpperCase('first'));

  if (game.isSimulation) {
    if (game.mode === 'fork')
      labels.push(game.mode.toUpperCase('first'));
  } else {
    if (game.mode)
      labels.push(game.mode.toUpperCase('first'));

    const isGuestGame = game.meta.ranks.some(r => r === false);

    if (!game.collection && game.mode !== 'fork')
      labels.push('Private');
    else if (!game.startedAt && game.rated === true)
      labels.push('Rated');
    else if (![ 'fork', 'practice' ].includes(game.mode) && game.rated === false && !isGuestGame)
      labels.push('Unrated');

    if (!game.startedAt && game.createdBy === Tactics.authClient.playerId) {
      const opponent = game.teams.find(t => t?.playerId !== game.createdBy);
      if (!opponent)
        labels.push('Anybody');
      else if (!opponent.playerId)
        labels.push('Share Link');
      else
        labels.push('Challenge');
    }
  }

  const spnLeft = document.createElement('SPAN');
  spnLeft.classList.add('left');
  spnLeft.textContent = labels.join(', ');
  divInfo.append(spnLeft);

  const spnRight = document.createElement('SPAN');
  spnRight.classList.add('right');
  if (game.startedAt)
    spnRight.append(renderDuration(game.currentTurnId));
  divInfo.append(spnRight);

  if (game.endedAt)
    spnRight.append(renderClock(game.endedAt, 'Ended At'));
  else if (game.startedAt && !game.isSimulation) {
    const isParticipant = game.teams.some(t => t.playerId === Tactics.authClient.playerId);
    if (isParticipant)
      spnRight.append(renderClock(spnClock => {
        const remaining = game.getTurnTimeRemaining();
        if (remaining < (game.currentTurnTimeLimit * 0.2))
          spnClock.classList.add('low');
        return remaining;
      }, 'Time Remaining'));
    else
      spnRight.append(renderClock(game.updatedAt, 'Updated At'));
  } else
    spnRight.append(renderClock(game.createdAt, 'Created At'));

  return divInfo;
}

/*
 * Info bar for a group card.  Uses the oldest game for all shared fields.
 * Style name is replaced with "<n> Styles".
 */
function renderGameGroupInfo(oldest, numStyles) {
  const divInfo = document.createElement('DIV');
  divInfo.classList.add('info');

  const labels = [];
  labels.push(`${numStyles} Styles`);
  if (!oldest.randomHitChance)
    labels.push('No Luck');
  if (oldest.timeLimitName && oldest.timeLimitName !== 'standard')
    labels.push(oldest.timeLimitName.toUpperCase('first'));
  if (oldest.mode)
    labels.push(oldest.mode.toUpperCase('first'));

  const isGuestGame = oldest.meta.ranks.some(r => r === false);
  if (oldest.rated === true)
    labels.push('Rated');
  else if (![ 'fork', 'practice' ].includes(oldest.mode) && oldest.rated === false && !isGuestGame)
    labels.push('Unrated');

  const spnLeft = document.createElement('SPAN');
  spnLeft.classList.add('left');
  spnLeft.textContent = labels.join(', ');
  divInfo.append(spnLeft);

  const spnRight = document.createElement('SPAN');
  spnRight.classList.add('right');
  spnRight.append(renderClock(oldest.createdAt, 'Created At'));
  divInfo.append(spnRight);

  return divInfo;
}

export function renderDuration(numTurns) {
  const spnTurns = document.createElement('SPAN');
  spnTurns.classList.add('duration');
  spnTurns.title = 'Turn Count';

  spnTurns.innerHTML = `
    <SPAN class="numTurns">${numTurns}</SPAN>
    <SPAN class="fa fa-hourglass"></SPAN>
  `;

  return spnTurns;
}
// updator can be a Function or a Date
export function renderClock(updator, title = 'Since') {
  const spnClock = document.createElement('SPAN');
  spnClock.classList.add('clock');
  spnClock.title = title;
  spnClock.innerHTML = `
    <SPAN class="elapsed"></SPAN>
    <SPAN class="fa fa-clock"></SPAN>
  `;
  spnClock.update = function () {
    let elapsed = (updator instanceof Function ? updator(spnClock) : Tactics.gameClient.serverNow - updator) / 1000;
    if (elapsed <= 0)
      elapsed = '0';
    else if (elapsed < 60)
      elapsed = '<1m';
    else if (elapsed < 3600)
      elapsed = Math.floor(elapsed / 60) + 'm';
    else if (elapsed < 86400)
      elapsed = Math.floor(elapsed / 3600) + 'h';
    else if (elapsed < 604800)
      elapsed = Math.floor(elapsed / 86400) + 'd';
    else if (elapsed < 31557600)
      elapsed = Math.floor(elapsed / 604800) + 'w';
    else
      elapsed = Math.floor(elapsed / 31557600) + 'y';

    this.querySelector('.elapsed').textContent = elapsed;
    return this;
  };

  return spnClock.update();
}